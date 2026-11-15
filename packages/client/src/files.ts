/** Browser helpers for saving and loading JSON files. */

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask the user for a JSON file. Resolves null if they cancel. */
export function readJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()));
      } catch (e) {
        reject(new Error(`could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`));
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
