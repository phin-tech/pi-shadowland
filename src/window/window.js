const token = location.hash.slice(1) || sessionStorage.getItem("shadowland-key");
if (token) sessionStorage.setItem("shadowland-key", token);
history.replaceState(null, "", location.pathname);
const element = id => document.getElementById(id);
const transcript = element("transcript");
let view;
let connected = false;
let busy = false;
let generation;
const displayed = new Set();

function feedback(text, error = false) {
  element("feedback").textContent = text;
  element("feedback").classList.toggle("error", error);
}

function renderControls() {
  if (!view) return;
  const options = view.scene.choices;
  element("decision").hidden = !options;
  element("choices").replaceChildren();
  options?.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const number = document.createElement("span");
    number.className = "choice-number";
    number.textContent = String(index + 1);
    button.append(number, document.createTextNode(option.text + (option.enabled ? "" : " (unavailable)")));
    button.disabled = !option.enabled || busy || !connected || !view.enabled || !!view.error;
    button.addEventListener("click", () => act("choose", { index: index + 1, choiceId: view.scene.choiceId }));
    element("choices").append(button);
  });
  element("continue").hidden = !!options || view.complete || !!view.error;
  element("continue").disabled = busy || !connected || !view.enabled;
}

function render(next) {
  view = next;
  element("story-title").textContent = view.title;
  document.title = `${view.title} — Shadowland`;
  element("agent-status").textContent = !view.enabled ? "Story paused" : view.agentActive ? "Agent working" : "Agent idle";
  element("progress").textContent = view.complete ? "Story complete" : `Exchange ${view.scene.beat}`;
  if (generation !== view.generation) { generation = view.generation; displayed.clear(); transcript.replaceChildren(); }
  const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 70;
  for (const scene of [...view.history, view.scene]) {
    if (displayed.has(scene.id) || !scene.lines.length) continue;
    displayed.add(scene.id);
    const section = document.createElement("section");
    section.className = "exchange";
    const heading = document.createElement("p");
    heading.className = "exchange-heading";
    heading.textContent = `${scene.title} · exchange ${scene.beat}`;
    section.append(heading);
    for (const line of scene.lines) {
      const row = document.createElement("div");
      row.className = "line";
      const speaker = document.createElement("span");
      speaker.className = "speaker";
      speaker.textContent = line.speaker;
      const text = document.createElement("p");
      text.textContent = line.text;
      row.append(speaker, text);
      section.append(row);
    }
    transcript.append(section);
  }
  if (follow) transcript.scrollTop = transcript.scrollHeight;
  element("cast").replaceChildren();
  for (const character of view.scene.characters) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = character.name;
    const persona = document.createElement("p");
    persona.textContent = character.persona;
    item.append(name, persona);
    element("cast").append(item);
  }
  renderControls();
  if (view.error) feedback(`Story stopped: ${view.error}`, true);
  else if (view.complete) feedback("This story has ended. Load another pack in the terminal.");
}

async function act(action, extra = {}) {
  if (busy || !view || !connected) return;
  busy = true;
  renderControls();
  feedback(action === "choose" ? "Following your choice…" : "Continuing…");
  try {
    const response = await fetch(`/${action}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sceneId: view.scene.id, generation: view.generation, ...extra }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    feedback("", false);
  } catch (error) { feedback(String(error), true); }
  finally {
    busy = false;
    renderControls();
    (element("choices").querySelector("button:not(:disabled)") || (!element("continue").hidden ? element("continue") : null))?.focus();
  }
}

element("continue").addEventListener("click", () => act("advance"));
element("popout").addEventListener("click", () => {
  window.open(`${location.origin}/#${token}`, "_blank", "noopener,popup,width=1000,height=780");
});

async function connect() {
  if (!token) throw new Error("Session key missing. Open the URL from /shadowland window.");
  const response = await fetch("/events", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw new Error(`Window connection failed (HTTP ${response.status}). Reopen with /shadowland window.`);
  connected = true;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffered.indexOf("\n\n")) !== -1) {
      const event = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (event.startsWith("data: ")) render(JSON.parse(event.slice(6)));
    }
  }
  throw new Error("Connection closed. Reopen with /shadowland window.");
}
connect().catch(error => {
  connected = false;
  element("agent-status").textContent = "Disconnected";
  feedback(String(error), true);
  renderControls();
});
