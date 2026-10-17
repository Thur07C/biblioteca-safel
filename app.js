/* Biblioteca Escolar — lógica de interface, Supabase e planilhas XLSX */
(() => {
  "use strict";

  // Configure com os dados do seu projeto Supabase (Project Settings > API).
  const SUPABASE_URL = "https://rxpnavfecwanuvzzwryh.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TD-Trwc9AGl_jRm-Kf7vYg_cHKaoZhO";

  const CONFIGURADO = !SUPABASE_URL.includes("SEU-PROJETO") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("SUA_CHAVE");
  const supabase = CONFIGURADO
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

  const $ = (id) => document.getElementById(id);
  let currentUser = null;
  let currentProfile = null;
  let allBooks = [];
  let toastTimeout;
  let resetChannel = null;

  const isAdmin = () => currentProfile?.papel === "admin";

  // A biblioteca de planilhas é pesada: só é baixada quando alguém usa exportar/modelo/importar.
  let xlsxPromise = null;
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(true);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
        s.onload = () => resolve(true);
        s.onerror = () => { xlsxPromise = null; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  /* ---------- utilidades ---------- */
  function showMessage(element, message, type = "") {
    if (!element) return;
    element.textContent = message;
    element.className = `message ${type}`.trim();
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove("show"), 3600);
  }

  function safeText(value, fallback = "Não informado") {
    const result = String(value ?? "").trim();
    return result || fallback;
  }

  function showLogin() {
    $("loginScreen").classList.remove("hidden");
    $("appScreen").classList.add("hidden");
  }

  function showApp() {
    $("loginScreen").classList.add("hidden");
    $("appScreen").classList.remove("hidden");
  }

  function setUserHeader(user, profile) {
    const metadataName = user?.user_metadata?.name || user?.user_metadata?.full_name;
    const emailName = user?.email ? user.email.split("@")[0] : "Usuário";
    const name = safeText(profile?.nome || metadataName || emailName, "Usuário");
    $("greetingText").textContent = `Olá, ${name}`;
    $("userAvatar").textContent = name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "U";
  }

  /* ---------- perfil e sessão ---------- */
  async function getProfile(user) {
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, papel")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function loadProfileAndApp(user) {
    currentUser = user;
    try {
      currentProfile = await getProfile(user);
    } catch (error) {
      console.error("Falha ao carregar perfil:", error);
      currentProfile = null;
    }
    setUserHeader(user, currentProfile);
    const admin = isAdmin();
    $("adminMenuButton").hidden = !admin;
    // Botões exclusivos do administrador (importar planilha).
    document.querySelectorAll("[data-admin-only]").forEach((el) => { el.hidden = !admin; });
    showApp();
    await loadBooks();
    if (admin) {
      loadUsers();
      loadResetRequests();
      subscribeResetRequests();
    }
  }

  async function login(event) {
    event.preventDefault();
    if (!supabase) {
      showMessage($("loginMessage"), "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no app.js antes de entrar.", "error");
      return;
    }
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const button = $("loginForm").querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Entrando...";
    showMessage($("loginMessage"), "");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    button.disabled = false;
    button.textContent = "Entrar";
    if (error) {
      showMessage($("loginMessage"), "Não foi possível entrar. Confira o e-mail e a senha.", "error");
      return;
    }
    await loadProfileAndApp(data.user);
  }

  async function logout() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) return toast("Não foi possível sair: " + error.message);
    clearSession();
  }

  function clearSession() {
    currentUser = null;
    currentProfile = null;
    if (resetChannel) { supabase.removeChannel(resetChannel); resetChannel = null; }
    $("loginForm").reset();
    showLogin();
  }

  /* ---------- "Esqueci a senha" (tela de login) ---------- */
  async function forgotPassword() {
    const email = $("loginEmail").value.trim();
    const msg = $("loginMessage");
    if (!supabase) return showMessage(msg, "Configure o Supabase antes de usar.", "error");
    if (!email) return showMessage(msg, "Digite seu e-mail no campo acima e clique em \"Esqueci a senha\".", "error");
    const { error } = await supabase.from("pedidos_senha").insert({ email });
    if (error) {
      console.error("Erro ao avisar administrador:", error);
      return showMessage(msg, "Não foi possível enviar o aviso. Procure o administrador.", "error");
    }
    // Mensagem neutra: não revela se o e-mail existe.
    showMessage(msg, "Aviso enviado ao administrador. Ele vai definir uma nova senha para você.", "success");
  }

  /* ---------- livros ---------- */
  function normalizeBook(row) {
    return {
      id: row.id,
      titulo: row.titulo || row.title || "Título não informado",
      autor: row.autor || row.author || "Autor não informado",
      isbn: row.isbn || row.ISBN || "",
      capa_url: row.capa_url || row.thumbnail || row.image_url || "",
      estante: row.estante ?? row.estante_numero ?? row.shelf ?? "",
      nivel: row.nivel ?? row.prateleira ?? row.level ?? "",
      posicao: row.posicao ?? row.posicao_frente_tras ?? row.position ?? "",
      observacoes: row.observacoes || row.observacao || ""
    };
  }

  async function loadBooks() {
    $("catalogMessage").textContent = "Carregando acervo...";
    const { data, error } = await supabase
      .from("livros")
      .select("id, titulo, autor, isbn, capa_url, estante, nivel, posicao, observacoes")
      .order("titulo", { ascending: true })
      .limit(5000);
    if (error) {
      console.error("Erro ao carregar livros:", error);
      allBooks = [];
      $("catalogMessage").textContent = "Não foi possível carregar os livros. Verifique a tabela, a conexão e as políticas RLS.";
      renderBooks();
      return;
    }
    allBooks = (data || []).map(normalizeBook);
    $("catalogMessage").textContent = "";
    renderBooks();
  }

  function coverElement(book, className = "book-cover") {
    const placeholderFor = () => {
      const p = document.createElement("div");
      p.className = "cover-placeholder";
      p.textContent = (book.titulo || "L").charAt(0).toLocaleUpperCase("pt-BR");
      return p;
    };
    if (book.capa_url && /^https?:\/\//i.test(book.capa_url)) {
      const img = document.createElement("img");
      img.className = className;
      img.src = book.capa_url;
      img.alt = `Capa de ${book.titulo}`;
      img.loading = "lazy";
      img.onerror = () => img.replaceWith(placeholderFor());
      return img;
    }
    return placeholderFor();
  }

  function renderBooks() {
    const query = $("searchInput").value.trim().toLocaleLowerCase("pt-BR");
    const filtered = allBooks.filter((book) =>
      [book.titulo, book.autor, book.isbn].some((value) =>
        String(value ?? "").toLocaleLowerCase("pt-BR").includes(query)
      )
    );
    const grid = $("booksGrid");
    grid.replaceChildren();
    const frag = document.createDocumentFragment();
    $("bookCount").textContent = String(filtered.length);
    $("emptyState").classList.toggle("hidden", filtered.length > 0);
    filtered.forEach((book) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "book-card";
      card.setAttribute("aria-label", `Ver localização de ${book.titulo}`);
      const coverWrap = document.createElement("div");
      coverWrap.className = "book-cover-wrap";
      coverWrap.appendChild(coverElement(book));
      const info = document.createElement("div");
      info.className = "book-info";
      const title = document.createElement("h3");
      title.className = "book-title";
      title.textContent = book.titulo;
      const author = document.createElement("p");
      author.className = "book-author";
      author.textContent = book.autor;
      const location = document.createElement("div");
      location.className = "book-location";
      location.textContent = `▦ Estante ${safeText(book.estante, "—")} · Nível ${safeText(book.nivel, "—")}`;
      info.append(title, author, location);
      card.append(coverWrap, info);
      card.addEventListener("click", () => openBookModal(book));
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function openBookModal(book) {
    $("modalTitle").textContent = book.titulo;
    $("modalAuthor").textContent = book.autor;
    $("modalIsbn").textContent = book.isbn ? `ISBN: ${book.isbn}` : "ISBN não informado";
    const cover = $("modalCover");
    cover.src = book.capa_url && /^https?:\/\//i.test(book.capa_url) ? book.capa_url : "";
    cover.alt = `Capa de ${book.titulo}`;
    cover.onerror = () => { cover.removeAttribute("src"); };
    $("mapShelfLabel").textContent = `Estante ${safeText(book.estante, "—")}`;
    $("mapLevelLabel").textContent = `Nível ${safeText(book.nivel, "—")}`;
    $("detailShelf").textContent = safeText(book.estante, "—");
    $("detailLevel").textContent = safeText(book.nivel, "—");
    $("detailPosition").textContent = safeText(book.posicao, "Não definida");
    $("modalLocationNote").textContent = book.observacoes || "O desenho é ilustrativo. Use a estante, o nível e a posição cadastrados para localizar o exemplar físico.";
    $("bookModal").classList.remove("hidden");
    $("closeModal").focus();
  }

  function closeModal() {
    $("bookModal").classList.add("hidden");
  }

  /* ---------- senha própria ---------- */
  async function changePassword(event) {
    event.preventDefault();
    if (!supabase || !currentUser) return;
    const current = $("currentPassword").value;
    const next = $("newPassword").value;
    const confirmPwd = $("confirmPassword").value;
    if (next.length < 8) return showMessage($("passwordMessage"), "A nova senha deve ter pelo menos 8 caracteres.", "error");
    if (next !== confirmPwd) return showMessage($("passwordMessage"), "A confirmação não corresponde à nova senha.", "error");

    const button = $("passwordForm").querySelector("button[type=submit]");
    button.disabled = true;
    showMessage($("passwordMessage"), "Validando senha atual...");
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: current
    });
    if (verifyError) {
      button.disabled = false;
      return showMessage($("passwordMessage"), "A senha atual está incorreta ou não foi possível validá-la.", "error");
    }
    // Corrigido: updateUser não aceita "current_password"; a validação já foi feita acima.
    const { error } = await supabase.auth.updateUser({ password: next });
    button.disabled = false;
    if (error) return showMessage($("passwordMessage"), "Não foi possível alterar a senha: " + error.message, "error");
    $("passwordForm").reset();
    showMessage($("passwordMessage"), "Senha alterada com sucesso.", "success");
  }

  /* ---------- administração: chamada à Edge Function ---------- */
  async function adminCall(body) {
    const { data, error } = await supabase.functions.invoke("admin-usuarios", { body });
    if (error || data?.error) {
      console.error("Erro admin:", error || data.error);
      throw new Error(data?.error || "Falha na operação. Confira se a Edge Function foi publicada.");
    }
    return data;
  }

  async function createUser(event) {
    event.preventDefault();
    if (!supabase || !isAdmin()) {
      return showMessage($("adminMessage"), "Apenas administradores podem criar usuários.", "error");
    }
    const payload = {
      action: "create",
      nome: $("newUserName").value.trim(),
      email: $("newUserEmail").value.trim(),
      password: $("newUserPassword").value,
      papel: $("newUserRole").value
    };
    if (payload.password.length < 8) return showMessage($("adminMessage"), "A senha inicial deve ter pelo menos 8 caracteres.", "error");
    const button = $("createUserForm").querySelector("button[type=submit]");
    button.disabled = true;
    showMessage($("adminMessage"), "Criando usuário...");
    try {
      await adminCall(payload);
      $("createUserForm").reset();
      showMessage($("adminMessage"), "");
      toast(`Usuário "${payload.nome}" criado com sucesso.`);
      await loadUsers();
    } catch (err) {
      showMessage($("adminMessage"), err.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- administração: lista de usuários ---------- */
  async function loadUsers() {
    const list = $("usersList");
    if (!list || !isAdmin()) return;
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nome, email, papel")
      .order("nome", { ascending: true });
    list.replaceChildren();
    if (error) {
      console.error("Erro ao listar usuários:", error);
      list.textContent = "Não foi possível carregar os usuários.";
      return;
    }
    if (!data.length) { list.textContent = "Nenhum usuário cadastrado."; return; }
    data.forEach((u) => {
      const row = document.createElement("div");
      row.className = "user-row";
      const info = document.createElement("div");
      info.className = "user-row-info";
      const name = document.createElement("strong");
      name.textContent = safeText(u.nome, "Sem nome");
      const mail = document.createElement("span");
      mail.textContent = ` ${safeText(u.email, "")} · ${u.papel === "admin" ? "Administrador" : "Operador"}`;
      info.append(name, mail);
      row.appendChild(info);
      if (u.id !== currentUser?.id) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn danger";
        del.textContent = "Excluir";
        del.addEventListener("click", () => deleteUser(u));
        row.appendChild(del);
      }
      list.appendChild(row);
    });
  }

  async function deleteUser(u) {
    if (!confirm(`Excluir o usuário "${safeText(u.nome, u.email)}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await adminCall({ action: "delete", id: u.id });
      toast("Usuário excluído.");
      await loadUsers();
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------- administração: pedidos de nova senha ---------- */
  async function loadResetRequests() {
    const list = $("resetRequestsList");
    if (!list || !isAdmin()) return;
    const { data, error } = await supabase
      .from("pedidos_senha")
      .select("id, email, criado_em")
      .eq("status", "pendente")
      .order("criado_em", { ascending: true });
    list.replaceChildren();
    const badge = $("resetBadge");
    if (error) {
      console.error("Erro ao listar pedidos:", error);
      list.textContent = "Não foi possível carregar os pedidos.";
      return;
    }
    if (badge) { badge.textContent = String(data.length); badge.hidden = data.length === 0; }
    if (!data.length) { list.textContent = "Nenhum pedido pendente."; return; }
    data.forEach((r) => {
      const row = document.createElement("div");
      row.className = "user-row";
      const info = document.createElement("div");
      info.className = "user-row-info";
      const mail = document.createElement("strong");
      mail.textContent = r.email;
      const when = document.createElement("span");
      when.textContent = " · " + new Date(r.criado_em).toLocaleString("pt-BR");
      info.append(mail, when);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Definir nova senha";
      btn.addEventListener("click", () => resetUserPassword(r));
      row.append(info, btn);
      list.appendChild(row);
    });
  }

  async function resetUserPassword(request) {
    const password = prompt(`Nova senha para ${request.email} (mínimo 8 caracteres):`);
    if (password === null) return;
    if (password.length < 8) return toast("A senha deve ter pelo menos 8 caracteres.");
    try {
      await adminCall({ action: "reset_password", email: request.email, password, request_id: request.id });
      toast(`Senha de ${request.email} redefinida. Informe a nova senha à pessoa.`);
      await loadResetRequests();
    } catch (err) {
      toast(err.message);
    }
  }

  function subscribeResetRequests() {
    if (resetChannel) return;
    resetChannel = supabase
      .channel("pedidos-senha")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos_senha" }, (payload) => {
        toast(`${payload.new?.email || "Um usuário"} esqueceu a senha.`);
        loadResetRequests();
      })
      .subscribe();
  }

  /* ---------- planilhas: exportar, modelo e importar ---------- */
  const COLUNAS = [
    ["Título", 38], ["Autor", 28], ["ISBN", 18], ["Estante", 14],
    ["Nível", 12], ["Posição (frente/trás)", 22], ["URL da capa", 45], ["Observações", 35]
  ];

  async function exportXlsx() {
    if (!(await ensureXlsx())) return toast("A biblioteca de exportação não carregou. Verifique sua conexão.");
    if (!allBooks.length) return toast("Não há livros carregados para exportar.");
    const rows = allBooks.map((book) => ({
      "Título": book.titulo,
      "Autor": book.autor,
      "ISBN": book.isbn,
      "Estante": book.estante,
      "Nível": book.nivel,
      "Posição (frente/trás)": book.posicao,
      "URL da capa": book.capa_url,
      "Observações": book.observacoes
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = COLUNAS.map(([, w]) => ({ wch: w }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Livros");
    XLSX.writeFile(workbook, `acervo-biblioteca-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Exportação XLSX iniciada.");
  }

  async function downloadTemplate() {
    if (!(await ensureXlsx())) return toast("A biblioteca de planilhas não carregou. Verifique sua conexão.");
    const sheet = XLSX.utils.aoa_to_sheet([COLUNAS.map(([n]) => n)]);
    // Coluna ISBN (C) em formato texto, para o Excel não transformar em 9,79E+12.
    for (let r = 2; r <= 500; r++) sheet["C" + r] = { t: "s", v: "", z: "@" };
    sheet["!ref"] = "A1:H500";
    sheet["!cols"] = COLUNAS.map(([, w]) => ({ wch: w }));
    const help = XLSX.utils.aoa_to_sheet([
      ["Como preencher"],
      ["Preencha uma linha por livro na aba \"Livros\". Apague nada na primeira linha (cabeçalho)."],
      ["Título é obrigatório. Os demais campos são opcionais."],
      ["Estante e Nível: número ou letra (ex.: 3 e 2). Posição: frente ou trás."],
      ["URL da capa: link começando com http:// ou https://."],
      ["Livros com ISBN já cadastrado são ignorados na importação."]
    ]);
    help["!cols"] = [{ wch: 90 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Livros");
    XLSX.utils.book_append_sheet(wb, help, "Instruções");
    XLSX.writeFile(wb, "modelo-importacao-livros.xlsx");
    toast("Modelo de planilha baixado.");
  }

  // Remove acentos, espaços e símbolos para reconhecer o cabeçalho de qualquer jeito.
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

  const ALIASES = {
    titulo: ["titulo", "title", "nome", "livro"],
    autor: ["autor", "author", "autores"],
    isbn: ["isbn"],
    estante: ["estante", "estantenumero", "shelf"],
    nivel: ["nivel", "prateleira", "level"],
    posicao: ["posicao", "posicaofrentetras", "position"],
    capa_url: ["urldacapa", "capaurl", "capa", "thumbnail", "imageurl"],
    observacoes: ["observacoes", "observacao", "obs"]
  };

  function mapRow(raw) {
    const out = {};
    const byNorm = {};
    Object.keys(raw).forEach((k) => { byNorm[norm(k)] = raw[k]; });
    for (const [field, names] of Object.entries(ALIASES)) {
      const hit = names.find((n) => n in byNorm);
      out[field] = hit ? String(byNorm[hit] ?? "").trim() : "";
    }
    return out;
  }

  async function importXlsx(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!isAdmin()) return toast("Apenas administradores podem importar livros.");
    if (!(await ensureXlsx())) return toast("A biblioteca de planilhas não carregou. Verifique sua conexão.");

    let found = [];
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
        // Só considera abas que tenham a coluna de título (ignora "Instruções").
        if (!rows.length || !Object.keys(rows[0]).some((k) => ALIASES.titulo.includes(norm(k)))) continue;
        rows.forEach((r) => { const b = mapRow(r); if (b.titulo) found.push(b); });
      }
    } catch (err) {
      console.error("Erro ao ler planilha:", err);
      return toast("Não foi possível ler o arquivo. Use o modelo .xlsx.");
    }
    if (!found.length) return toast("Nenhum livro encontrado. Confira se há a coluna \"Título\".");

    // Ignora duplicados por ISBN (já no acervo ou repetidos na própria planilha).
    const digits = (s) => String(s).replace(/[^0-9Xx]/g, "").toUpperCase();
    const seen = new Set(allBooks.map((b) => digits(b.isbn)).filter(Boolean));
    const novos = [];
    let ignorados = 0;
    for (const b of found) {
      const key = digits(b.isbn);
      if (key && seen.has(key)) { ignorados++; continue; }
      if (key) seen.add(key);
      novos.push(b);
    }
    if (!novos.length) return toast(`Nada a importar: ${ignorados} livro(s) já existem no acervo.`);
    if (!confirm(`Importar ${novos.length} livro(s) novo(s)?` + (ignorados ? ` (${ignorados} duplicado(s) serão ignorados)` : ""))) return;

    // Campos vazios não geram erro: ficam em branco (ex.: sem ISBN, o livro só não é achado por ISBN).
    const vazio = (v) => (v === "" ? null : v);
    const linhas = novos.map((b) => ({
      titulo: b.titulo, autor: b.autor, isbn: vazio(b.isbn), capa_url: vazio(b.capa_url),
      estante: vazio(b.estante), nivel: vazio(b.nivel), posicao: vazio(b.posicao), observacoes: vazio(b.observacoes)
    }));
    toast("Importando livros...");
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabase.from("livros").insert(linhas.slice(i, i + 500));
      if (error) {
        console.error("Erro ao importar:", error);
        await loadBooks();
        return toast("Falha ao importar: " + error.message);
      }
    }
    await loadBooks();
    toast(`${novos.length} livro(s) importado(s) com sucesso.`);
  }

  /* ---------- navegação ---------- */
  function setView(viewId) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== viewId));
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
    closeSidebar();
    if (isAdmin() && $("adminMenuButton").dataset.view === viewId) { loadUsers(); loadResetRequests(); }
  }

  function openSidebar() {
    $("sidebar").classList.add("open");
    $("sidebarScrim").classList.add("show");
    $("menuButton").setAttribute("aria-expanded", "true");
    $("menuButton").textContent = "✕";
  }
  function closeSidebar() {
    $("sidebar").classList.remove("open");
    $("sidebarScrim").classList.remove("show");
    $("menuButton").setAttribute("aria-expanded", "false");
    $("menuButton").textContent = "☰";
  }

  function applyTheme(tema, salvar = true) {
    document.documentElement.dataset.theme = tema;
    document.querySelectorAll("[data-theme-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === tema)));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tema === "dark" ? "#0f1623" : "#2459a9");
    if (salvar) { try { localStorage.setItem("tema", tema); } catch (e) { /* sem armazenamento */ } }
  }

  function bindEvents() {
    $("loginForm").addEventListener("submit", login);
    $("forgotButton")?.addEventListener("click", forgotPassword);
    $("logoutButton").addEventListener("click", logout);
    let searchTimer;
    $("searchInput").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderBooks, 120); });
    $("clearSearch").addEventListener("click", () => { $("searchInput").value = ""; renderBooks(); $("searchInput").focus(); });
    $("excelMenuButton").addEventListener("click", () => {
      const sub = $("excelSubmenu");
      const abrir = sub.hidden;
      sub.hidden = !abrir;
      $("excelMenuButton").setAttribute("aria-expanded", String(abrir));
    });
    $("exportButton").addEventListener("click", () => { closeSidebar(); exportXlsx(); });
    document.querySelectorAll("[data-theme-btn]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeBtn)));
    applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light", false);
    $("templateButton")?.addEventListener("click", () => { closeSidebar(); downloadTemplate(); });
    $("importButton")?.addEventListener("click", () => { closeSidebar(); $("importFile").click(); });
    $("importFile")?.addEventListener("change", importXlsx);
    $("passwordForm").addEventListener("submit", changePassword);
    $("createUserForm").addEventListener("submit", createUser);
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    $("menuButton").addEventListener("click", () => $("sidebar").classList.contains("open") ? closeSidebar() : openSidebar());
    $("sidebarScrim").addEventListener("click", closeSidebar);
    $("closeModal").addEventListener("click", closeModal);
    document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { closeModal(); closeSidebar(); }
    });
  }

  async function init() {
    bindEvents();
    if (!CONFIGURADO) {
      showLogin();
      showMessage($("loginMessage"), "Antes de usar, configure as duas constantes do Supabase no início de app.js.", "error");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await loadProfileAndApp(session.user);
    else showLogin();

    supabase.auth.onAuthStateChange((event, sessionNow) => {
      if (event === "SIGNED_OUT" || !sessionNow) clearSession();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
