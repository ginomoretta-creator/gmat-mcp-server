// Toggle between test and full pages
const USE_TEST_PAGES = process.env.NODE_ENV === 'test';

import pagesData from '../../pages.json' with { type: "json" };
import testPagesData from '../../pages-test.json' with { type: "json" };

export interface Page {
  name: string;
  href: string;
}

export const PAGES: Page[] = USE_TEST_PAGES ? testPagesData : pagesData;