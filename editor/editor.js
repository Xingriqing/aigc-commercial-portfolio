(() => {
  "use strict";

  const OWNER = "Xingriqing";
  const REPO = "aigc-visual-portfolio";
  const BRANCH = "main";
  const CONTENT_PATH = "data/content.js";
  const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
  let content = clone(window.__PORTFOLIO_CONTENT__);
  let currentMode = "site";
  let currentProjectSlug = Object.keys(content.projects ?? {})[0] ?? "";
  let currentExperienceId = Object.keys(content.experiences ?? {})[0] ?? "";
  const savedDeviceToken = localStorage.getItem("portfolioEditorToken") ?? "";
  let token = savedDeviceToken || sessionStorage.getItem("portfolioEditorToken") || "";
  let connectedUser = null;
  const pendingFiles = new Map();
  const previewUrls = new Map();

  const form = document.querySelector("[data-editor-form]");
  const status = document.querySelector("[data-editor-status]");
  const pendingStatus = document.querySelector("[data-pending-status]");
  const connectionStatus = document.querySelector("[data-connection-status]");
  const tokenInput = document.querySelector("#github-token");
  const connectButton = document.querySelector("[data-connect]");
  const disconnectButton = document.querySelector("[data-disconnect]");
  const rememberDevice = document.querySelector("[data-remember-device]");
  const projectSelect = document.querySelector("[data-project-select]");
  const experienceSelect = document.querySelector("[data-experience-select]");
  const saveButton = document.querySelector(".button--publish");
  const stillsList = document.querySelector("[data-stills-list]");
  const linksList = document.querySelector("[data-links-list]");
  const environmentLists = [...document.querySelectorAll("[data-environment-list]")];

  tokenInput.value = token;
  // Trusted-device mode is the default. If an older editor already stored the
  // token in sessionStorage, the automatic connection below migrates it to
  // localStorage without asking the user to paste it again.
  rememberDevice.checked = true;

  function input(name) {
    return form.elements.namedItem(name);
  }

  function setInput(name, value) {
    const field = input(name);
    if (field) field.value = value ?? "";
  }

  function getInput(name) {
    return String(input(name)?.value ?? "").trim();
  }

  function lines(value) {
    return String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  function setStatus(message, type = "") {
    status.textContent = message;
    status.classList.toggle("is-error", type === "error");
    status.classList.toggle("is-ok", type === "ok");
  }

  function setConnection(message, type = "") {
    connectionStatus.textContent = message;
    connectionStatus.classList.toggle("is-error", type === "error");
    connectionStatus.classList.toggle("is-ok", type === "ok");
  }

  function updatePendingStatus() {
    const count = pendingFiles.size;
    const bytes = [...pendingFiles.values()].reduce((sum, item) => sum + item.blob.size, 0);
    pendingStatus.textContent = count
      ? `待发布 ${count} 个新文件，共 ${(bytes / 1024 / 1024).toFixed(2)} MB。`
      : "没有待上传的新文件；文字修改和删除操作仍可直接保存。";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function assetUrl(value) {
    if (!value) return "";
    const path = String(value).replace(/^\.\//, "");
    if (previewUrls.has(path)) return previewUrls.get(path);
    if (/^(https?:|blob:|data:)/i.test(value)) return value;
    return `../${path.replace(/^\//, "")}`;
  }

  function renderPreview(slot, value, type = "image", fit = "contain", position = "center") {
    const box = document.querySelector(`[data-preview="${slot}"]`);
    if (!box) return;
    const url = assetUrl(value);
    if (!url) {
      box.innerHTML = `<span>${slot === "video" ? "视频预览" : "图片预览"}</span>`;
      return;
    }
    box.innerHTML = type === "video"
      ? `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`
      : `<img src="${escapeHtml(url)}" alt="" style="object-fit:${fit};object-position:${position}">`;
  }

  const profileFields = ["name", "englishName", "title", "titleCN", "disciplines", "disciplinesCN", "introEn", "introZh", "email", "phone", "wechat", "portfolioUrl", "resumeUrl"];
  const heroFields = ["image", "alt", "caption", "fit", "position"];
  const experienceFields = ["company", "companyCN", "location", "locationCN", "role", "roleCN", "type", "period", "summary", "confidentialityNote"];
  const projectStringFields = ["title", "subtitle", "year", "category", "client", "platform", "projectType", "status", "description", "coverImage", "videoUrl", "coverAspect", "coverFit", "sourceNote"];

  function loadSite() {
    content.profile ??= {};
    content.hero ??= {};
    profileFields.forEach((field) => setInput(`profile.${field}`, content.profile[field]));
    heroFields.forEach((field) => setInput(`hero.${field}`, content.hero[field]));
    if (!getInput("hero.fit")) setInput("hero.fit", "cover");
    if (!getInput("hero.position")) setInput("hero.position", "center");
    renderPreview("hero", content.hero.image, "image", content.hero.fit ?? "cover", content.hero.position ?? "center");
  }

  function saveSite() {
    content.profile ??= {};
    content.hero ??= {};
    profileFields.forEach((field) => { content.profile[field] = getInput(`profile.${field}`); });
    heroFields.forEach((field) => { content.hero[field] = getInput(`hero.${field}`); });
  }

  function populateExperiences() {
    experienceSelect.innerHTML = Object.entries(content.experiences ?? {}).map(([id, item]) =>
      `<option value="${escapeHtml(id)}">${escapeHtml(item.companyCN || item.company || item.roleCN || id)}</option>`
    ).join("");
    if (!currentExperienceId || !content.experiences?.[currentExperienceId]) currentExperienceId = experienceSelect.options[0]?.value ?? "";
    experienceSelect.value = currentExperienceId;
  }

  function loadExperience() {
    const item = content.experiences?.[currentExperienceId] ?? {};
    experienceFields.forEach((field) => setInput(`experience.${field}`, item[field]));
    setInput("experience.responsibilities", (item.responsibilities ?? []).join("\n"));
  }

  function saveExperience() {
    if (!currentExperienceId) return;
    const item = content.experiences[currentExperienceId] ?? {};
    experienceFields.forEach((field) => { item[field] = getInput(`experience.${field}`); });
    item.responsibilities = lines(getInput("experience.responsibilities"));
    item.featured = item.featured !== false;
    content.experiences[currentExperienceId] = item;
  }

  function populateProjects() {
    projectSelect.innerHTML = Object.entries(content.projects ?? {}).map(([slug, project]) =>
      `<option value="${escapeHtml(slug)}">${escapeHtml(project.title || slug)}</option>`
    ).join("");
    if (!currentProjectSlug || !content.projects?.[currentProjectSlug]) currentProjectSlug = projectSelect.options[0]?.value ?? "";
    projectSelect.value = currentProjectSlug;
  }

  function currentProject() {
    return content.projects?.[currentProjectSlug] ?? {};
  }

  function loadProject() {
    const project = currentProject();
    projectStringFields.forEach((field) => setInput(`project.${field}`, project[field]));
    setInput("project.role", (project.role ?? []).join("\n"));
    setInput("project.responsibilities", (project.responsibilities ?? []).join("\n"));
    setInput("project.tools", (project.tools ?? []).join("\n"));
    if (!getInput("project.coverAspect")) setInput("project.coverAspect", "16:9");
    if (!getInput("project.coverFit")) setInput("project.coverFit", "cover");
    renderPreview("cover", project.coverImage, "image", project.coverFit ?? "cover");
    renderPreview("video", project.videoUrl, "video");
    renderStills();
    renderLinks();
  }

  function saveProject() {
    if (!currentProjectSlug) return;
    const project = currentProject();
    projectStringFields.forEach((field) => { project[field] = getInput(`project.${field}`); });
    project.role = lines(getInput("project.role"));
    project.responsibilities = lines(getInput("project.responsibilities"));
    project.tools = lines(getInput("project.tools"));
    project.coverVideo = project.videoUrl || null;
    project.coverAlt = project.coverAlt || `${project.title || currentProjectSlug} project cover`;
    content.projects[currentProjectSlug] = project;
  }

  function renderStills() {
    const stills = currentProject().stills ?? [];
    if (!stills.length) {
      stillsList.innerHTML = '<p class="empty-state">还没有关键帧图片。</p>';
      return;
    }
    stillsList.innerHTML = stills.map((still, index) => `
      <div class="repeat-row" data-still-index="${index}">
        <div class="repeat-row__thumb"><img src="${escapeHtml(assetUrl(still.src))}" alt=""></div>
        <div class="repeat-row__fields">
          <label>标题<input data-still-field="label" value="${escapeHtml(still.label || `Selected Frame ${index + 1}`)}"></label>
          <label>替代文字<input data-still-field="alt" value="${escapeHtml(still.alt || "Project frame")}"></label>
          <label>显示比例<select data-still-field="aspect">${aspectOptions(still.aspect || "16:9")}</select></label>
          <label>显示方式<select data-still-field="fit"><option value="cover"${still.fit !== "contain" ? " selected" : ""}>裁切铺满</option><option value="contain"${still.fit === "contain" ? " selected" : ""}>完整显示</option></select></label>
        </div>
        <div class="repeat-row__actions">
          <button type="button" class="button button--quiet" data-move="up"${index === 0 ? " disabled" : ""}>上移</button>
          <button type="button" class="button button--quiet" data-move="down"${index === stills.length - 1 ? " disabled" : ""}>下移</button>
          <button type="button" class="button button--danger" data-remove>删除</button>
        </div>
      </div>`).join("");
  }

  function renderLinks() {
    const project = currentProject();
    const links = project.externalLinks?.length ? project.externalLinks : project.externalLink?.url ? [project.externalLink] : [];
    project.externalLinks = links;
    if (!links.length) {
      linksList.innerHTML = '<p class="empty-state">还没有外部链接。</p>';
      return;
    }
    linksList.innerHTML = links.map((link, index) => `
      <div class="repeat-row link-row" data-link-index="${index}">
        <div class="repeat-row__fields">
          <label>按钮文字<input data-link-field="label" value="${escapeHtml(link.label || "查看公开页面")}"></label>
          <label>链接地址<input data-link-field="url" type="url" value="${escapeHtml(link.url || "")}"></label>
        </div>
        <div class="repeat-row__actions"><button type="button" class="button button--danger" data-remove>删除</button></div>
      </div>`).join("");
  }

  function ensureEnvironment() {
    content.environmentGallery ??= {};
    content.environmentGallery.groups ??= [[], []];
    while (content.environmentGallery.groups.length < 2) content.environmentGallery.groups.push([]);
  }

  function renderEnvironment() {
    ensureEnvironment();
    environmentLists.forEach((list, groupIndex) => {
      const images = content.environmentGallery.groups[groupIndex];
      if (!images.length) {
        list.innerHTML = '<p class="empty-state">这一组还没有图片。</p>';
        return;
      }
      list.innerHTML = images.map((image, index) => `
        <div class="repeat-row" data-environment-index="${index}">
          <div class="repeat-row__thumb"><img src="${escapeHtml(assetUrl(image.src))}" alt=""></div>
          <div class="repeat-row__fields">
            <label class="span-two">图片下方文字<textarea rows="2" data-environment-field="caption">${escapeHtml(image.caption || "")}</textarea></label>
            <label>替代文字<input data-environment-field="alt" value="${escapeHtml(image.alt || "")}"></label>
            <label>显示比例<select data-environment-field="aspect">${aspectOptions(image.aspect || "16:9")}</select></label>
            <label>显示方式<select data-environment-field="fit"><option value="cover"${image.fit !== "contain" ? " selected" : ""}>裁切铺满</option><option value="contain"${image.fit === "contain" ? " selected" : ""}>完整显示</option></select></label>
          </div>
          <div class="repeat-row__actions">
            <button type="button" class="button button--quiet" data-move="up"${index === 0 ? " disabled" : ""}>上移</button>
            <button type="button" class="button button--quiet" data-move="down"${index === images.length - 1 ? " disabled" : ""}>下移</button>
            <button type="button" class="button button--danger" data-remove>删除</button>
          </div>
        </div>`).join("");
    });
  }

  function aspectOptions(selected) {
    return ["16:9", "3:2", "4:3", "1:1", "3:4", "4:5", "9:16"]
      .map((value) => `<option value="${value}"${selected === value ? " selected" : ""}>${value}</option>`).join("");
  }

  function saveCurrentMode() {
    if (currentMode === "site") saveSite();
    if (currentMode === "experience") saveExperience();
    if (currentMode === "project") saveProject();
  }

  function loadCurrentMode() {
    if (currentMode === "site") loadSite();
    if (currentMode === "experience") loadExperience();
    if (currentMode === "project") loadProject();
    if (currentMode === "environment") renderEnvironment();
  }

  function switchMode(mode) {
    saveCurrentMode();
    currentMode = mode;
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== mode; });
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
    loadCurrentMode();
    window.scrollTo({ top: document.querySelector(".editor-layout").offsetTop - 16, behavior: "smooth" });
  }

  function safeSegment(value) {
    return String(value || "asset").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "asset";
  }

  async function optimizeImage(file) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    const bitmap = await createImageBitmap(file);
    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", .84));
    if (!blob) return file;
    return blob.size < file.size || file.size > 1024 * 1024 ? blob : file;
  }

  async function queueFile(file, folder, slot) {
    let blob = file;
    let extension = file.name.split(".").pop()?.toLowerCase() || "bin";
    if (file.type.startsWith("image/")) {
      blob = await optimizeImage(file);
      if (blob.type === "image/webp") extension = "webp";
    }
    if (blob.size > MAX_FILE_SIZE) throw new Error(`${file.name} 超过20MB，请先压缩后再上传。`);
    const id = crypto.randomUUID().slice(0, 8);
    const path = `media/uploads/${safeSegment(folder)}/${safeSegment(slot)}-${Date.now()}-${id}.${extension}`;
    pendingFiles.set(path, { blob, originalName: file.name });
    previewUrls.set(path, URL.createObjectURL(blob));
    updatePendingStatus();
    return `./${path}`;
  }

  async function handleUpload(type, files) {
    try {
      if (!files.length) return;
      setStatus("正在处理素材，请稍候……");
      if (type === "resume") {
        const url = await queueFile(files[0], "site-resume", "resume");
        setInput("profile.resumeUrl", url);
      } else if (type === "hero") {
        const url = await queueFile(files[0], "site-hero", "hero");
        setInput("hero.image", url);
        renderPreview("hero", url, "image", getInput("hero.fit") || "cover", getInput("hero.position") || "center");
      } else if (type === "cover") {
        const url = await queueFile(files[0], currentProjectSlug, "cover");
        setInput("project.coverImage", url);
        renderPreview("cover", url, "image", getInput("project.coverFit") || "cover");
      } else if (type === "video") {
        const url = await queueFile(files[0], currentProjectSlug, "film");
        setInput("project.videoUrl", url);
        renderPreview("video", url, "video");
      } else if (type === "stills") {
        const project = currentProject();
        project.stills ??= [];
        for (const file of files) {
          const url = await queueFile(file, currentProjectSlug, `frame-${project.stills.length + 1}`);
          project.stills.push({ src: url, alt: `${project.title || currentProjectSlug} project frame`, label: `Selected Frame ${project.stills.length + 1}`, aspect: currentProjectSlug === "quzhong-ren-weihuan" ? "9:16" : "16:9", fit: "cover" });
        }
        renderStills();
      } else if (type.startsWith("environment-")) {
        ensureEnvironment();
        const groupIndex = Number(type.split("-")[1]);
        const group = content.environmentGallery.groups[groupIndex];
        const available = 4 - group.length;
        if (available <= 0) throw new Error("这一组已经有4张图片，请先删除再添加。");
        for (const file of files.slice(0, available)) {
          const url = await queueFile(file, "site-environment", `environment-group-${groupIndex + 1}`);
          group.push({ src: url, alt: file.name.replace(/\.[^.]+$/, ""), caption: "", aspect: "16:9", fit: "cover" });
        }
        renderEnvironment();
      }
      setStatus("素材已加入待发布列表；点击“保存并发布到 GitHub”后才会更新线上网站。", "ok");
    } catch (error) {
      setStatus(error.message || "素材处理失败。", "error");
    }
  }

  async function github(path, options = {}) {
    if (!token) throw new Error("请先连接 GitHub。 ");
    const response = await fetch(path.startsWith("http") ? path : `${API_ROOT}${path}`, {
      ...options,
      cache: options.cache ?? "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });
    const result = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = result?.message || `${response.status} ${response.statusText}`;
      throw new Error(`GitHub 请求失败：${details}`);
    }
    return result;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(String(value).replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function parseContentFile(source) {
    const equals = source.indexOf("=");
    if (equals < 0) throw new Error("线上内容文件格式不正确。");
    return JSON.parse(source.slice(equals + 1).trim().replace(/;\s*$/, ""));
  }

  async function loadLatestFromGitHub() {
    const file = await github(`/contents/${CONTENT_PATH}?ref=${encodeURIComponent(BRANCH)}`);
    if (!file?.content) throw new Error("无法读取线上内容文件。");
    content = parseContentFile(decodeBase64Utf8(file.content));
    currentProjectSlug = Object.keys(content.projects ?? {})[0] ?? "";
    currentExperienceId = Object.keys(content.experiences ?? {})[0] ?? "";
    populateProjects();
    populateExperiences();
    loadCurrentMode();
  }

  async function connect() {
    const candidate = tokenInput.value.trim();
    if (!candidate) {
      setConnection("请先粘贴 GitHub token。", "error");
      return;
    }
    connectButton.disabled = true;
    setConnection("正在验证令牌……");
    token = candidate;
    try {
      connectedUser = await github("https://api.github.com/user");
      const repository = await github("");
      if (!repository.permissions?.push && !repository.permissions?.admin) throw new Error("这个令牌没有仓库写入权限，请检查 Contents 是否为 Read and write。");
      if (rememberDevice.checked) {
        localStorage.setItem("portfolioEditorToken", token);
        sessionStorage.removeItem("portfolioEditorToken");
      } else {
        sessionStorage.setItem("portfolioEditorToken", token);
        localStorage.removeItem("portfolioEditorToken");
      }
      disconnectButton.hidden = false;
      setConnection(`已连接：@${connectedUser.login}，正在读取 GitHub 最新内容……`, "ok");
      await loadLatestFromGitHub();
      setConnection(`已连接：@${connectedUser.login}。最新内容已载入，可以编辑和发布。`, "ok");
      setStatus("已从 GitHub 仓库重新载入最新内容。", "ok");
    } catch (error) {
      token = "";
      localStorage.removeItem("portfolioEditorToken");
      sessionStorage.removeItem("portfolioEditorToken");
      setConnection(error.message || "GitHub 连接失败。", "error");
    } finally {
      connectButton.disabled = false;
    }
  }

  function disconnect() {
    token = "";
    connectedUser = null;
    tokenInput.value = "";
    localStorage.removeItem("portfolioEditorToken");
    sessionStorage.removeItem("portfolioEditorToken");
    disconnectButton.hidden = true;
    setConnection("令牌已从这台电脑的浏览器中清除。", "ok");
  }

  function contentFileSource() {
    return `window.__PORTFOLIO_CONTENT__ = ${JSON.stringify(content, null, 2)};\n`;
  }

  async function blobToBase64(blob) {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < buffer.length; i += chunkSize) {
      binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function createBlob(data, encoding) {
    return github("/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: data, encoding }),
    });
  }

  function isFastForwardError(error) {
    return /fast[ -]?forward/i.test(String(error?.message ?? ""));
  }

  async function commitTreeEntries(treeEntries) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      setStatus(attempt === 1 ? "正在读取 GitHub 最新版本……" : `检测到线上版本更新，正在自动重试（${attempt}/3）……`);
      const ref = await github(`/git/ref/heads/${BRANCH}?_=${Date.now()}-${attempt}`);
      const headSha = ref.object.sha;
      const commit = await github(`/git/commits/${headSha}`);
      const tree = await github("/git/trees", {
        method: "POST",
        body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }),
      });
      const dateLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date());
      const newCommit = await github("/git/commits", {
        method: "POST",
        body: JSON.stringify({
          message: `Update portfolio via editor - ${dateLabel}`,
          tree: tree.sha,
          parents: [headSha],
        }),
      });
      try {
        await github(`/git/refs/heads/${BRANCH}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: newCommit.sha, force: false }),
        });
        return newCommit;
      } catch (error) {
        lastError = error;
        if (!isFastForwardError(error) || attempt === 3) throw error;
      }
    }
    throw lastError;
  }

  async function publish() {
    saveCurrentMode();
    if (!token) {
      setStatus("请先在页面顶部连接 GitHub，再发布。", "error");
      tokenInput.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    content.updatedAt = new Date().toISOString();
    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    try {
      const treeEntries = [];

      let completed = 0;
      for (const [path, item] of pendingFiles) {
        completed += 1;
        saveButton.textContent = `上传素材 ${completed}/${pendingFiles.size}`;
        setStatus(`正在上传：${item.originalName}`);
        const base64 = await blobToBase64(item.blob);
        const blob = await createBlob(base64, "base64");
        treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      }

      saveButton.textContent = "写入网站内容";
      setStatus("正在写入作品集内容……");
      const contentBlob = await createBlob(contentFileSource(), "utf-8");
      treeEntries.push({ path: CONTENT_PATH, mode: "100644", type: "blob", sha: contentBlob.sha });
      const newCommit = await commitTreeEntries(treeEntries);

      pendingFiles.clear();
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
      updatePendingStatus();
      setStatus(`发布成功，提交 ${newCommit.sha.slice(0, 7)}。GitHub Pages 通常会在几分钟内更新。`, "ok");
      saveButton.textContent = "发布成功 ✓";
      setTimeout(() => { saveButton.textContent = originalLabel; }, 3500);
    } catch (error) {
      setStatus(error.message || "发布失败，请检查网络和令牌权限。", "error");
      saveButton.textContent = originalLabel;
    } finally {
      saveButton.disabled = false;
    }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.mode)));
  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);
  tokenInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); connect(); } });

  projectSelect.addEventListener("change", () => {
    saveProject();
    currentProjectSlug = projectSelect.value;
    loadProject();
  });
  experienceSelect.addEventListener("change", () => {
    saveExperience();
    currentExperienceId = experienceSelect.value;
    loadExperience();
  });

  document.querySelectorAll("[data-upload]").forEach((field) => field.addEventListener("change", async () => {
    await handleUpload(field.dataset.upload, [...(field.files ?? [])]);
    field.value = "";
  }));

  input("hero.image").addEventListener("change", () => renderPreview("hero", getInput("hero.image"), "image", getInput("hero.fit") || "cover", getInput("hero.position") || "center"));
  input("hero.fit").addEventListener("change", () => renderPreview("hero", getInput("hero.image"), "image", getInput("hero.fit"), getInput("hero.position") || "center"));
  input("hero.position").addEventListener("change", () => renderPreview("hero", getInput("hero.image"), "image", getInput("hero.fit") || "cover", getInput("hero.position")));
  input("project.coverImage").addEventListener("change", () => renderPreview("cover", getInput("project.coverImage"), "image", getInput("project.coverFit") || "cover"));
  input("project.coverFit").addEventListener("change", () => renderPreview("cover", getInput("project.coverImage"), "image", getInput("project.coverFit")));
  input("project.videoUrl").addEventListener("change", () => renderPreview("video", getInput("project.videoUrl"), "video"));

  stillsList.addEventListener("input", (event) => {
    const row = event.target.closest("[data-still-index]");
    const field = event.target.dataset.stillField;
    if (!row || !field) return;
    currentProject().stills[Number(row.dataset.stillIndex)][field] = event.target.value;
  });
  stillsList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-still-index]");
    if (!row || !event.target.closest("button")) return;
    const index = Number(row.dataset.stillIndex);
    const items = currentProject().stills;
    if (event.target.closest("[data-remove]")) items.splice(index, 1);
    const direction = event.target.closest("[data-move]")?.dataset.move;
    if (direction) {
      const next = index + (direction === "up" ? -1 : 1);
      if (next >= 0 && next < items.length) [items[index], items[next]] = [items[next], items[index]];
    }
    renderStills();
  });

  document.querySelector("[data-add-link]").addEventListener("click", () => {
    const project = currentProject();
    project.externalLinks ??= [];
    project.externalLinks.push({ label: "查看公开页面", url: "" });
    renderLinks();
  });
  linksList.addEventListener("input", (event) => {
    const row = event.target.closest("[data-link-index]");
    const field = event.target.dataset.linkField;
    if (!row || !field) return;
    currentProject().externalLinks[Number(row.dataset.linkIndex)][field] = event.target.value;
    currentProject().externalLink = currentProject().externalLinks[0] ?? null;
  });
  linksList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-link-index]");
    if (!row || !event.target.closest("[data-remove]")) return;
    currentProject().externalLinks.splice(Number(row.dataset.linkIndex), 1);
    currentProject().externalLink = currentProject().externalLinks[0] ?? null;
    renderLinks();
  });

  environmentLists.forEach((list, groupIndex) => {
    list.addEventListener("input", (event) => {
      const row = event.target.closest("[data-environment-index]");
      const field = event.target.dataset.environmentField;
      if (!row || !field) return;
      content.environmentGallery.groups[groupIndex][Number(row.dataset.environmentIndex)][field] = event.target.value;
    });
    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-environment-index]");
      if (!row || !event.target.closest("button")) return;
      const index = Number(row.dataset.environmentIndex);
      const items = content.environmentGallery.groups[groupIndex];
      if (event.target.closest("[data-remove]")) items.splice(index, 1);
      const direction = event.target.closest("[data-move]")?.dataset.move;
      if (direction) {
        const next = index + (direction === "up" ? -1 : 1);
        if (next >= 0 && next < items.length) [items[index], items[next]] = [items[next], items[index]];
      }
      renderEnvironment();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    publish();
  });

  populateProjects();
  populateExperiences();
  ensureEnvironment();
  loadSite();
  updatePendingStatus();

  if (token) {
    disconnectButton.hidden = false;
    setConnection("检测到当前标签页已有令牌，正在验证……");
    connect();
  }
})();
