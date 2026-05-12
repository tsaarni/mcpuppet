// Stage that rejects pages that exceeded the redirect limit and re-validates the final URL against the URL policy.
import { config } from '../config.ts';
import type { Stage } from '../types.ts';
import { validateUrlPolicy } from './url-policy.ts';

export const redirectGuardStage: Stage = {
  name: 'redirect-guard',
  async execute(ctx) {
    const redirectCount = ctx.redirectCount ?? 0;
    if (redirectCount > config.maxRedirects) {
      throw new Error(`Too many redirects: ${redirectCount}`);
    }

    if (!ctx.url) {
      throw new Error('Missing final URL for redirect validation');
    }

    validateUrlPolicy(ctx.url);
    return ctx;
  },
};
