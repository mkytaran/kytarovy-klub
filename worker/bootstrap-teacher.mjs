const API_URL = "https://kytarovy-klub-api.kytara.workers.dev/api/v2/auth/bootstrap";

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
  const name = await readHidden("Jméno učitele: ");
  const password = await readHidden("Nové heslo učitele (12 až 128 znaků): ");
  const confirmation = await readHidden("Zopakuj nové heslo: ");
  if (bootstrapSecret.length < 24) {
    throw new Error("Bootstrap tajemství musí mít alespoň 24 znaků.");
  }
  if (name.trim().length < 2 || name.trim().length > 80) {
    throw new Error("Jméno musí mít 2 až 80 znaků.");
  }
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
    body: JSON.stringify({ name, password })
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Vytvoření účtu selhalo (HTTP ${response.status}, neplatná odpověď).`);
  }
  if (!response.ok) {
    throw new Error(result.error || `Vytvoření účtu selhalo (HTTP ${response.status}).`);
  }
  console.log(`Učitelský účet ${result.user.name} byl vytvořen.`);
}

main().catch((error) => {
  console.error(error.message || "Učitelský účet se nepodařilo vytvořit.");
  process.exitCode = 1;
});
