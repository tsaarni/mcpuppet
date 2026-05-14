// Browser-side script injected via page.evaluate() to dismiss cookie consent dialogs.

interface CmpSelector {
  selector: string | null;
  cmp: string;
  shadowRoot?: boolean;
}

type AcceptPattern = (text: string) => boolean;

export interface DismissResult {
  dismissed: boolean;
  cmp: string | null;
}

export function dismissCookieConsent(): DismissResult {
  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  const knownCmpSelectors: CmpSelector[] = [
    { selector: '#CybotCookiebotDialogBodyButtonAccept', cmp: 'CookieBot' },
    { selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', cmp: 'CookieBot' },
    { selector: '#onetrust-accept-btn-handler', cmp: 'OneTrust' },
    { selector: '.cky-btn-accept', cmp: 'CookieYes' },
    { selector: null, cmp: 'Quantcast', shadowRoot: true },
    { selector: '#truste-consent-button', cmp: 'TrustArc' },
    { selector: '#didomi-notice-agree-button', cmp: 'Didomi' },
    { selector: '.osano-cm-accept-all', cmp: 'Osano' },
    { selector: '.cmplz-accept', cmp: 'Complianz' },
    { selector: 'button#L2AGLb', cmp: 'Google' },
    { selector: 'button[aria-label*="Accept"]', cmp: 'Google' },
    { selector: 'form[action*="consent"] button', cmp: 'Google' },
  ];

  for (const entry of knownCmpSelectors) {
    if (entry.shadowRoot) {
      const container: HTMLElement | null = document.querySelector('div#qc-cmp2-container');
      const shadowRoot: ShadowRoot | null | undefined = container?.shadowRoot;
      if (shadowRoot) {
        const btn: Element | null = shadowRoot.querySelector('.qc-cmp2-summary-buttons button[mode="primary"]');
        if (btn && isVisible(btn)) {
          (btn as HTMLElement).click();
          return { dismissed: true, cmp: entry.cmp };
        }
      }
    } else if (entry.selector) {
      const btn: Element | null = document.querySelector(entry.selector);
      if (btn && isVisible(btn)) {
        (btn as HTMLElement).click();
        return { dismissed: true, cmp: entry.cmp };
      }
    }
  }

  const consentContainerSelectors: string[] = [
    '[class*="consent"]',
    '[class*="cookie"]',
    '[id*="cookie"]',
    '[id*="consent"]',
    '[class*="gdpr"]',
    'form[action*="consent"]',
    '[role="dialog"][aria-modal="true"]',
    '[role="dialog"][class*="cookie"], [role="dialog"][class*="consent"], [role="dialog"][class*="gdpr"]',
  ];

  const acceptPatterns: AcceptPattern[] = [
    (t: string): boolean => t.includes('accept all'),
    (t: string): boolean => t.includes('accept cookies'),
    (t: string): boolean => t.includes('allow all'),
    (t: string): boolean => t.includes('allow cookies'),
    (t: string): boolean => t.includes('got it'),
    (t: string): boolean => t.includes('i agree'),
    (t: string): boolean => /\bagree\b/.test(t),
    (t: string): boolean => /\baccept\b/.test(t),
    (t: string): boolean => /^ok$/i.test(t),
    (t: string): boolean => t.includes('hyv\u00e4ksy kaikki'),
    (t: string): boolean => t.includes('alle akzeptieren'),
    (t: string): boolean => t.includes('tout accepter'),
    (t: string): boolean => t.includes('aceptar todo'),
    (t: string): boolean => t.includes('accetta tutto'),
    (t: string): boolean => t.includes('acceptera alla'),
    (t: string): boolean => t.includes('alles accepteren'),
    (t: string): boolean => t.includes('aceitar tudo'),
  ];

  for (const containerSelector of consentContainerSelectors) {
    const containers: NodeListOf<Element> = document.querySelectorAll(containerSelector);
    for (const container of containers) {
      if (!isVisible(container)) continue;
      const buttons: NodeListOf<Element> = container.querySelectorAll('button, a[role="button"], a.button, [role="button"]');
      for (const btn of buttons) {
        const text: string = (btn.textContent ?? '').toLowerCase().trim();
        if (acceptPatterns.some((p: AcceptPattern): boolean => p(text))) {
          if (isVisible(btn)) {
            (btn as HTMLElement).click();
            return { dismissed: true, cmp: 'heuristic' };
          }
        }
      }
    }
  }

  return { dismissed: false, cmp: null };
}
