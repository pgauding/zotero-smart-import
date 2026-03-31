import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const _ztoolkit = new MyToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog =
    __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog =
    __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}

import {
  ProgressWindowHelper,
  MenuManager,
  UITool,
  BasicTool,
  unregister,
} from "zotero-plugin-toolkit";

class MyToolkit extends BasicTool {
  UI: UITool;
  ProgressWindow: typeof ProgressWindowHelper;
  Menu: MenuManager;

  constructor() {
    super();
    this.UI = new UITool(this);
    this.ProgressWindow = ProgressWindowHelper;
    this.Menu = new MenuManager(this);
  }

  unregisterAll() {
    unregister(this);
  }
}
