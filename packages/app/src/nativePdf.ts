type Debuggee = { tabId: number };
type ChromeApi = {
  runtime: { lastError?: { message?: string } };
  tabs: { getCurrent: (callback: (tab?: { id?: number }) => void) => void };
  debugger: {
    attach: (target: Debuggee, version: string, callback: () => void) => void;
    detach: (target: Debuggee, callback: () => void) => void;
    sendCommand: (target: Debuggee, method: string, options: object, callback: (result?: { data?: string }) => void) => void;
  };
};

/** Normal NW.js exposes this internal transport without a remote debug port.
 * Its legacy print preview API crashes in 0.115.0, even for a minimal page.
 * nw-manifest.json silences the connection's browser infobar for this app.
 */
export async function captureNativePdf(): Promise<Uint8Array> {
  const api = (window as Window & { chrome?: ChromeApi }).chrome;
  if (!api?.debugger || !api.tabs) throw new Error("PDF export is unavailable in this runtime. Export HTML instead.");
  function call<T>(invoke: (done: (result: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("PDF export timed out.")), 30_000);
      try {
        invoke(result => {
          clearTimeout(timeout);
          const error = api!.runtime.lastError;
          if (error) reject(new Error(error.message ?? "PDF export failed.")); else resolve(result);
        });
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
  }
  const tab = await call<{ id?: number } | undefined>(done => api.tabs.getCurrent(done));
  if (typeof tab?.id !== "number") throw new Error("The current document could not be identified for PDF export.");
  const target = { tabId: tab.id };
  await call<void>(done => api.debugger.attach(target, "1.3", done));
  try {
    const result = await call<{ data?: string } | undefined>(done => api.debugger.sendCommand(target, "Page.printToPDF", {
      printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true,
      marginTop: 0.79, marginBottom: 0.79, marginLeft: 0.79, marginRight: 0.79,
      generateTaggedPDF: true,
    }, done));
    if (!result?.data) throw new Error("The PDF renderer returned no document.");
    return Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
  } finally { await call<void>(done => api.debugger.detach(target, done)); }
}
