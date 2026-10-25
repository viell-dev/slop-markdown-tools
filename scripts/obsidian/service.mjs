// Retain the upstream worker; validate only after its launcher has supplied both binaries.
import { launcher as ObsidianLauncher } from "wdio-obsidian-service";
import { SevereServiceError } from "webdriverio";
import { assertProvidedBinaries } from "./provided-binaries/index.mjs";

export { default } from "wdio-obsidian-service";

export class launcher extends ObsidianLauncher {
  async onPrepare(config, capabilities) {
    await super.onPrepare(config, capabilities);
    try {
      for (const capability of capabilities) assertProvidedBinaries(capability);
    } catch (error) {
      // Ordinary WDIO hooks log errors and continue. Its launcher aborts for this class.
      throw new SevereServiceError(error.message);
    }
  }
}
