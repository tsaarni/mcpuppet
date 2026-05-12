import { config } from '../config.ts';
import type { Stage } from '../types.ts';

export const navigateStage: Stage = {
  name: 'navigate',
  async execute(ctx) {
    if (!ctx.page || !ctx.url) {
      throw new Error('URL and page are required for navigation');
    }
    await ctx.page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
    return {
      ...ctx,
      url: ctx.page.url(),
      html: await ctx.page.content(),
      title: await ctx.page.title(),
    };
  },
};
