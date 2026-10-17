/* Biblioteca Escolar — lógica de interface, Supabase e exportação XLSX */
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

  function showMessage(element, message, type = "") {
    element.textContent = message;
    element.className = `message ${type}`.trim();
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove("show"), 3200);
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
    // Não mostrar cargo ou badge de função na interface.
  }

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
    const isAdmin = currentProfile?.papel === "admin";
    $("adminMenuButton").hidden = !isAdmin;
    showApp();
    await loadBooks();
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
    currentUser = null;
    currentProfile = null;
    $("loginForm").reset();
    showLogin();
  }

  function normalizeBook(row) {
    // Aceita nomes de colunas comuns usados na sincronização da planilha.
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
    if (book.capa_url && /^https?:\/\//i.test(book.capa_url)) {
      const img = document.createElement("img");
      img.className = className;
      img.src = book.capa_url;
      img.alt = `Capa de ${book.titulo}`;
      img.loading = "lazy";
      img.onerror = () => {
        const placeholder = document.createElement("div");
        placeholder.className = "cover-placeholder";
        placeholder.textContent = (book.titulo || "L").charAt(0).toLocaleUpperCase("pt-BR");
        img.replaceWith(placeholder);
      };
      return img;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "cover-placeholder";
    placeholder.textContent = (book.titulo || "L").charAt(0).toLocaleUpperCase("pt-BR");
    return placeholder;
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
      grid.appendChild(card);
    });
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

  async function changePassword(event) {
    event.preventDefault();
    if (!supabase || !currentUser) return;
    const current = $("currentPassword").value;
    const next = $("newPassword").value;
    const confirm = $("confirmPassword").value;
    if (next.length < 8) return showMessage($("passwordMessage"), "A nova senha deve ter pelo menos 8 caracteres.", "error");
    if (next !== confirm) return showMessage($("passwordMessage"), "A confirmação não corresponde à nova senha.", "error");

    const button = $("passwordForm").querySelector("button[type=submit]");
    button.disabled = true;
    showMessage($("passwordMessage"), "Validando senha atual...");
    // Reautentica com a senha atual. A sessão existente não é suficiente para provar que
    // o valor digitado em "Senha atual" está correto.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: current
    });
    if (verifyError) {
      button.disabled = false;
      return showMessage($("passwordMessage"), "A senha atual está incorreta ou não foi possível validá-la.", "error");
    }

    const { error } = await supabase.auth.updateUser({
      password: next,
      current_password: current
    });
    button.disabled = false;
    if (error) return showMessage($("passwordMessage"), "Não foi possível alterar a senha: " + error.message, "error");
    $("passwordForm").reset();
    showMessage($("passwordMessage"), "Senha alterada com sucesso.", "success");
  }

  async function createUser(event) {
    event.preventDefault();
    if (!supabase || currentProfile?.papel !== "admin") {
      return showMessage($("adminMessage"), "Apenas administradores podem criar usuários.", "error");
    }
    const payload = {
      nome: $("newUserName").value.trim(),
      email: $("newUserEmail").value.trim(),
      password: $("newUserPassword").value,
      papel: $("newUserRole").value
    };
    if (payload.password.length < 8) return showMessage($("adminMessage"), "A senha inicial deve ter pelo menos 8 caracteres.", "error");
    const button = $("createUserForm").querySelector("button[type=submit]");
    button.disabled = true;
    showMessage($("adminMessage"), "Criando usuário...");
    // A Edge Function deve validar o JWT do chamador e confirmar papel=admin no servidor.
    const { data, error } = await supabase.functions.invoke("admin-criar-usuario", { body: payload });
    button.disabled = false;
    if (error || data?.error) {
      console.error("Erro ao criar usuário:", error || data.error);
      return showMessage($("adminMessage"), data?.error || "Falha ao criar usuário. Confira se a Edge Function foi publicada.", "error");
    }
    $("createUserForm").reset();
    showMessage($("adminMessage"), "Usuário criado com sucesso.", "success");
  }

  function exportXlsx() {
    if (!window.XLSX) return toast("A biblioteca de exportação não carregou. Verifique sua conexão.");
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
    sheet["!cols"] = [{wch:38},{wch:28},{wch:18},{wch:14},{wch:12},{wch:22},{wch:45},{wch:35}];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Livros");
    XLSX.writeFile(workbook, `acervo-biblioteca-${new Date().toISOString().slice(0,10)}.xlsx`);
    toast("Exportação XLSX iniciada.");
  }

  function setView(viewId) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== viewId));
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
    closeSidebar();
  }

  function openSidebar() {
    $("sidebar").classList.add("open");
    $("sidebarScrim").classList.add("show");
    $("menuButton").setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    $("sidebar").classList.remove("open");
    $("sidebarScrim").classList.remove("show");
    $("menuButton").setAttribute("aria-expanded", "false");
  }

  function bindEvents() {
    $("loginForm").addEventListener("submit", login);
    $("logoutButton").addEventListener("click", logout);
    $("searchInput").addEventListener("input", renderBooks);
    $("clearSearch").addEventListener("click", () => { $("searchInput").value = ""; renderBooks(); $("searchInput").focus(); });
    $("exportButton").addEventListener("click", exportXlsx);
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
      if (event === "SIGNED_OUT" || !sessionNow) {
        currentUser = null;
        currentProfile = null;
        showLogin();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
