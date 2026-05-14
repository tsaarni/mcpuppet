// Stage that rejects pages that exceeded the redirect limit and re-validates the final URL against the URL policy.
import { config } from '../config.ts';
import { Stage } from '../types.ts';
import type { StageContext } from '../types.ts';
import { validateUrlPolicy } from './url-policy.ts';

export class RedirectGuardStage extends Stage {
  execute(ctx: StageContext): StageContext {
    const redirectCount = ctx.redirectCount ?? 0;
    if (redirectCount > config.maxRedirects) {
      throw new Error(`Too many redirects: ${redirectCount}`);
    }

    if (!ctx.url) {
      throw new Error('Missing final URL for redirect validation');
    }

    // Re-validate the final URL after redirects to prevent SSRF bypasses where an
    // attacker provides a safe-looking URL that redirects to an internal resource
    // (e.g., https://evil.com → http://169.254.169.254/).
    validateUrlPolicy(ctx.url);
    return ctx;
  }
}
