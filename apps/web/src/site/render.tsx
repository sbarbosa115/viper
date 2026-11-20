/** @jsxRuntime automatic */
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './landing-page.js';
import { LegalPage } from './legal-page.js';
import type { LandingModel, LegalModel } from './types.js';

/*
 * Server entry points for the api (ADR 0016). The pages are not hydrated, so they are rendered
 * as static markup (no React text markers); the client script enhances the plain HTML.
 */

export function renderLandingPage(model: LandingModel): string {
  return `<!doctype html>${renderToStaticMarkup(<LandingPage model={model} />)}`;
}

export function renderLegalPage(model: LegalModel): string {
  return `<!doctype html>${renderToStaticMarkup(<LegalPage model={model} />)}`;
}
