// App-wide state. Screens read from here and call the router through the ctx they are given.
export const S = {
  boot: null,           // response of /api/bootstrap
  lang: 'en',
  themePref: 'light',    // 'auto' | 'light' | 'dark'
  activeCount: 0,       // open orders, shown as a badge on the Orders tab
  drafts: { buy: {}, sell: {} },
};

export const catalogMethod = (code) => S.boot?.catalog.methods.find((m) => m.code === code);
export const catalogNetwork = (code) => S.boot?.catalog.networks.find((n) => n.code === code);
