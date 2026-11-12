const API_URL = "https://kytarovy-klub-api.kytara.workers.dev/api/v2/auth/teacher-password";

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error("Spusť tento skript v interaktivním terminálu."));
      return;
    }

    const input = process.stdin;
    let value = "";
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Zrušeno."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };

    input.on("data", onData);
  });
}

async function main() {
  const bootstrapSecret = await readHidden("Bootstrap tajemství: ");
  const password = await readHidden("Nové heslo učitele (12 až 128 znaků): ");
  const confirmation = await readHidden("Zopakuj nové heslo: ");
  if (password.length < 12 || password.length > 128) {
    throw new Error("Heslo musí mít 12 až 128 znaků.");
  }
  if (password !== confirmation) throw new Error("Zadaná hesla se neshodují.");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bootstrapSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Změna hesla selhala (HTTP ${response.status}).`);
  }
  console.log("Heslo učitele bylo změněno. Přihlas se novým heslem.");
}

main().catch((error) => {
  console.error(error.message || "Heslo se nepodařilo změnit.");
  process.exitCode = 1;
});
