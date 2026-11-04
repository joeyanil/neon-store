// The four social platforms: their names, icons and the colour class each one uses.
export const PLATFORMS = [
  { code: 'telegram', name: 'Telegram', icon: 'send' },
  { code: 'instagram', name: 'Instagram', icon: 'camera' },
  { code: 'tiktok', name: 'TikTok', icon: 'note' },
  { code: 'youtube', name: 'YouTube', icon: 'play' },
];
export const platformOf = (code) => PLATFORMS.find((p) => p.code === code) || { code: 'other', name: 'Other', icon: 'bag' };
