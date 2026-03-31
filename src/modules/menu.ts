import { runSmartImport } from "./importer";

export function registerMenus() {
  ztoolkit.Menu.register("menuFile", {
    tag: "menuitem",
    id: "smartimport-file-menu",
    label: "Smart .bib Import...",
    commandListener: () => {
      runSmartImport().catch((err) => {
        ztoolkit.log("Smart Import error:", err);
        const win = Zotero.getMainWindow();
        Zotero.alert(
          win as unknown as Window,
          "Smart Import Error",
          String(err),
        );
      });
    },
  });
}
