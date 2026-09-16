import { ChatConfig, TemplateColors, WidgetFonts } from '@/lib/chat/types';
import { REIBLAST_TREE_JSON } from '@/lib/chat/trees/reiblast';

export const chatConfig: ChatConfig = {
  enabled: true,
  mode: 'tree',
  brandName: 'REIblast',
  assistantName: 'REIblast Assistant',
  captureEmail: true,
  // No ctaFormHref: consent + lead capture now happen inline in the widget's
  // own consent-review step, so a separate "contact form" CTA is redundant
  // (and /marketing/contact was a broken public path — middleware serves
  // marketing routes at /{path}, not /marketing/{path}).
  treeId: 'reiblast',
  treeJson: REIBLAST_TREE_JSON,
};

export const chatColors: TemplateColors = {
  primary: '#0A0A0A',
  accent: '#F5C842',
  background: '#141414',
  text: '#FFFFFF',
};

export const chatFonts: WidgetFonts = {
  heading: 'Inter, system-ui, sans-serif',
  body: 'Inter, system-ui, sans-serif',
};
