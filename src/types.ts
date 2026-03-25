export type AppState = 'idle' | 'uploaded' | 'processing' | 'result';

export interface StyleOption {
  id: string;
  name: string;
  preview: string;
  prompt: string;
}

export interface ProcessingParams {
  intensity: 'low' | 'standard' | 'high';
  resolution: '720p' | '1080p';
  smoothness: 'standard';
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  originalName: string;
  styleName: string;
  thumbnail: string;
}

export const STYLES: StyleOption[] = [
  {
    id: 'hand-drawn',
    name: 'Nano Banana Pro · 高级手绘',
    preview: 'https://picsum.photos/seed/sketch/200/200',
    prompt: 'High-end professional hand-drawn tutorial style, clean lines, minimalist aesthetic, technical drawing, architectural sketch.'
  },
  {
    id: 'pencil',
    name: '铅笔素描',
    preview: 'https://picsum.photos/seed/pencil/200/200',
    prompt: 'Detailed graphite pencil sketch, fine shading, artistic texture, hand-drawn on paper.'
  },
  {
    id: 'art-sketch',
    name: '艺术速写',
    preview: 'https://picsum.photos/seed/art/200/200',
    prompt: 'Expressive artistic gesture drawing, rapid ink lines, minimalist representation, high contrast.'
  },
  {
    id: 'watercolor',
    name: '水彩质感',
    preview: 'https://picsum.photos/seed/watercolor/200/200',
    prompt: 'Soft watercolor painting, elegant color bleeds, artistic wash, minimalist background.'
  },
  {
    id: 'anime',
    name: '动漫手绘',
    preview: 'https://picsum.photos/seed/anime/200/200',
    prompt: 'Clean anime cel-shaded style, sharp line art, vibrant but controlled colors, modern animation look.'
  }
];
