import type { Http } from "./http.js";
import type { ResolvedConnectorOptions } from "./config.js";

export interface ModuleContext {
  http: Http;
  options: ResolvedConnectorOptions;
}
