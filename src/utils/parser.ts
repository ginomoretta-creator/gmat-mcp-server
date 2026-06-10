import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { PAGES } from './pages.js';

export interface Chunk {
  id: string;
  pageName: string;
  href: string;
  fullContent: string;
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Configure turndown to preserve structure
turndownService.addRule('preserveLineBreaks', {
  filter: ['p', 'div', 'br'],
  replacement: (content: string, node: any) => {
    if (node.nodeName === 'BR') {
      return '\n';
    }
    return content + '\n\n';
  }
});

function findPageName(href: string): string {
  const page = PAGES.find((p: { href: string }) => p.href === href);
  return page?.name || href.replace('.html', '');
}

function generateChunkId(href: string, index: number, heading?: string): string {
  const baseId = href.replace('.html', '');
  if (heading) {
    // Create anchor-like ID from heading
    const anchor = heading.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_');
    return `${baseId}#${anchor}`;
  }
  return `${baseId}#chunk_${index}`;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

export function parseAndChunk(html: string, href: string): Chunk[] {
  const $ = cheerio.load(html);
  
  // Remove irrelevant elements
  $('.nav, .footer, .navigation, .breadcrumb, script, style, .sidebar, .toc').remove();
  
  // Try to find main content area
  let contentElement = $('#content, #main-content, .content, .main, main, article').first();
  if (contentElement.length === 0) {
    contentElement = $('body');
  }
  
  const pageName = findPageName(href);
  const chunks: Chunk[] = [];
  
  // Find all headings to use as chunk boundaries
  const headings = contentElement.find('h1, h2, h3, h4').toArray();
  
  if (headings.length === 0) {
    // No headings found - treat entire page as one chunk
    const fullContent = cleanText(turndownService.turndown(contentElement.html() || ''));
    if (fullContent.length > 0) {
      chunks.push({
        id: generateChunkId(href, 0),
        pageName,
        href,
        fullContent,
      });
    }
    return chunks;
  }
  
  // Process content by heading sections
  for (let i = 0; i < headings.length; i++) {
    const heading = $(headings[i]);
    const headingText = heading.text().trim();
    
    // Collect all content until the next heading of same or higher level
    let content = heading.clone();
    let nextElement = heading.next();
    
    while (nextElement.length > 0) {
      const nextTag = nextElement.get(0)?.tagName?.toLowerCase();
      
      // Stop if we hit another heading of same or higher level
      if (nextTag && /^h[1-6]$/.test(nextTag)) {
        const currentLevel = parseInt(headings[i].tagName.charAt(1));
        const nextLevel = parseInt(nextTag.charAt(1));
        if (nextLevel <= currentLevel) {
          break;
        }
      }
      
      content = content.add(nextElement);
      nextElement = nextElement.next();
    }
    
    // Convert to markdown and clean
    const markdownContent = turndownService.turndown(content.toString());
    const fullContent = cleanText(markdownContent);
    
    if (fullContent.length > 0) {
      chunks.push({
        id: generateChunkId(href, i, headingText),
        pageName,
        href,
        fullContent,
      });
    }
  }
  
  // If no chunks were created (shouldn't happen), create one from entire content
  if (chunks.length === 0) {
    const fullContent = cleanText(turndownService.turndown(contentElement.html() || ''));
    if (fullContent.length > 0) {
      chunks.push({
        id: generateChunkId(href, 0),
        pageName,
        href,
        fullContent,
      });
    }
  }
  
  return chunks;
}