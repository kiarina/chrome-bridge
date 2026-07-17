const form = document.querySelector("#signup-form");

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams({
      name: data.get("name") || "Morgan Rivera",
      workspace: data.get("workspace") || "Northstar Studio",
    });
    window.location.assign(`complete.html?${params.toString()}`);
  });
}

if (document.body.classList.contains("complete-page")) {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name")?.trim();
  const workspace = params.get("workspace")?.trim();
  if (name) document.querySelector("#welcome-name").textContent = name.split(/\s+/)[0];
  if (workspace) document.querySelector("#workspace-name").textContent = workspace;
}
