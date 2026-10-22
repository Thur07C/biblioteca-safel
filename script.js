
"use strict";

// Substitua pela URL real do Web App do Google Apps Script.
const API_URL = "COLE_A_URL_DO_APPS_SCRIPT/exec";

const SESSION_KEY = "biblioteca_token";
const USER_KEY = "biblioteca_usuario";

const $ = (id) => document.getElementById(id);

let books = [];
let currentUser = "";

function message(id, text, type = "info") {
  const target = $(id);
  target.replaceChildren();

  if (!text) return;

  const div = document.createElement("div");
  div.className = `notice ${type}`;
  div.textContent = text;
  target.appendChild(div);
}

function setBusy(button, busy, normal, waiting) {
  button.disabled = busy;
  button.textContent = busy ? waiting : normal;
}

function token() {
  return localStorage.getItem(SESSION_KEY) || "";
}

async function requestApi(action, payload = {}) {
  if (!API_URL.startsWith("https://script.google.com/") ||
      !API_URL.endsWith("/exec")) {
    throw new Error("Configure a URL correta do Apps Script no script.js.");
  }

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action, ...payload }),
      redirect: "follow"
    });
  } catch {
    throw new Error(
      "Falha de comunicação com o Apps Script. " +
      "Verifique o deploy e a configuração de acesso."
    );
  }

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status}.`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "A resposta não é JSON válido. Verifique a implantação do backend."
    );
  }

  if (!data.success) {
    if (data.code === "SESSION_EXPIRED") endSession(false);
    throw new Error(data.message || "Não foi possível concluir a operação.");
  }

  return data;
}

async function getBooksFromServer() {
  const url = new URL(API_URL);
  url.searchParams.set("action", "books");
  url.searchParams.set("token", token());

  let response;

  try {
    response = await fetch(url.toString(), { redirect: "follow" });
  } catch {
    throw new Error(
      "Não foi possível consultar o acervo. Verifique a comunicação com o Apps Script."
    );
  }

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status}.`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Resposta inválida do servidor.");
  }

  if (!data.success) {
    if (data.code === "SESSION_EXPIRED") endSession(false);
    throw new Error(data.message || "Falha ao consultar o acervo.");
  }

  return Array.isArray(data.books) ? data.books : [];
}

function showLogin() {
  $("loginScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
}

function showApp() {
  $("loginScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
  $("userName").textContent = currentUser;
  $("userAvatar").textContent =
    currentUser.trim().charAt(0).toUpperCase() || "U";
}

function endSession(showMessage = true) {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
  currentUser = "";
  showLogin();

  if (showMessage) {
    message("loginMessage", "Sessão encerrada.", "info");
  }
}

// LOGIN
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("loginButton");
  const username = $("loginUser").value.trim();
  const password = $("loginPassword").value;

  message("loginMessage", "");

  setBusy(button, true, "Entrar", "Entrando...");

  try {
    const result = await requestApi("login", { username, password });

    if (!result.token || !result.username) {
      throw new Error("O servidor não retornou uma sessão válida.");
    }

    localStorage.setItem(SESSION_KEY, result.token);
    localStorage.setItem(USER_KEY, result.username);
    currentUser = result.username;

    $("loginForm").reset();
    showApp();

    // Não encerra a sessão se apenas a consulta falhar.
    loadBooks().catch((error) => {
      message("catalogMessage", error.message, "error");
    });
  } catch (error) {
    message("loginMessage", error.message, "error");
  } finally {
    setBusy(button, false, "Entrar", "Entrando...");
  }
});

// LOGOUT
$("logoutButton").addEventListener("click", async () => {
  const oldToken = token();

  endSession();

  if (oldToken) {
    try {
      await requestApi("logout", { token: oldToken });
    } catch (error) {
      console.warn("A sessão local foi encerrada:", error.message);
    }
  }
});

// ABAS
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
    });

    ["registerPanel", "catalogPanel"].forEach((id) => {
      $(id).classList.toggle("hidden", id !== tab.dataset.tab);
    });

    if (tab.dataset.tab === "catalogPanel") {
      loadBooks().catch((error) => {
        message("catalogMessage", error.message, "error");
      });
    }
  });
});

// ISBN: formato de ISBN-10 ou ISBN-13, com hífens opcionais.
function isValidISBN(value) {
  const input = value.trim().toUpperCase();

  if (!/^[0-9-]+X?$/.test(input)) return false;

  const compact = input.replace(/-/g, "");

  return /^[0-9]{9}X$/.test(compact) ||
         /^[0-9]{10}$/.test(compact) ||
         /^[0-9]{13}$/.test(compact);
}

// CADASTRO
$("bookForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveButton");
  message("bookMessage", "");

  const book = {
    id: $("bookId").value.trim(),
    title: $("title").value.trim(),
    author: $("author").value.trim(),
    publisher: $("publisher").value.trim(),
    isbn: $("isbn").value.trim().toUpperCase()
  };

  if (!isValidISBN(book.isbn)) {
    message(
      "bookMessage",
      "Este provavelmente não é um ISBN. Tente novamente com o ISBN correto.",
      "error"
    );
    $("isbn").focus();
    return;
  }

  if (Object.values(book).some((value) => !value)) {
    message("bookMessage", "Preencha todos os campos.", "error");
    return;
  }

  setBusy(button, true, "Salvar na Planilha", "Salvando...");

  try {
    const result = await requestApi("saveBook", {
      token: token(),
      book
    });

    $("bookForm").reset();

    message(
      "bookMessage",
      result.message || "Livro salvo com sucesso!",
      "success"
    );

    await loadBooks();
  } catch (error) {
    message("bookMessage", error.message, "error");
  } finally {
    setBusy(button, false, "Salvar na Planilha", "Salvando...");
  }
});

// CONSULTA
async function loadBooks() {
  message("catalogMessage", "Carregando acervo...", "info");

  books = await getBooksFromServer();
  renderBooks();

  message(
    "catalogMessage",
    `${books.length} livro(s) carregado(s).`,
    "success"
  );
}

// PESQUISA
function renderBooks() {
  const query = $("searchInput").value.trim().toLocaleLowerCase("pt-BR");
  const tbody = $("bookTableBody");
  tbody.replaceChildren();

  const filtered = books.filter((book) => {
    const searchable = [book.id, book.title, book.isbn]
      .join(" ")
      .toLocaleLowerCase("pt-BR");

    return searchable.includes(query);
  });

  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = books.length
      ? "Nenhum livro corresponde à pesquisa."
      : "Nenhum livro cadastrado.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  filtered.forEach((book) => {
    const row = document.createElement("tr");

    [book.id, book.title, book.author, book.publisher, book.isbn]
      .forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value == null ? "" : String(value);
        row.appendChild(cell);
      });

    tbody.appendChild(row);
  });
}

$("searchInput").addEventListener("input", renderBooks);

$("refreshButton").addEventListener("click", () => {
  loadBooks().catch((error) => {
    message("catalogMessage", error.message, "error");
  });
});

// RESTAURAÇÃO DA SESSÃO
async function initialize() {
  const savedToken = token();
  const savedUser = localStorage.getItem(USER_KEY);

  if (!savedToken || !savedUser) {
    showLogin();
    return;
  }

  currentUser = savedUser;
  showApp();

  try {
    await loadBooks();
  } catch (error) {
    message("catalogMessage", error.message, "error");
  }
}

initialize();
