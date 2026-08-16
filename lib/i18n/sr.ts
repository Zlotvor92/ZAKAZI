export const sr = {
  app: {
    name: "ZAKAZI",
    description: "Zakazivanje termina za beauty profesionalce",
  },
  signIn: {
    title: "Prijava",
    subtitle: "Pošaljemo ti link na mejl. Bez lozinke.",
    emailLabel: "Mejl adresa",
    emailPlaceholder: "ime@primer.rs",
    submit: "Pošalji mi link",
    submitting: "Šaljem…",
    sentTitle: "Proveri mejl",
    sentBody: "Poslali smo ti link za prijavu. Važi 60 minuta.",
    invalidEmail: "Unesi ispravnu mejl adresu.",
    failed: "Slanje nije uspelo. Pokušaj ponovo za koji trenutak.",
  },
  callback: {
    failed: "Link nije važeći ili je istekao. Zatraži novi.",
  },
  dashboard: {
    signOut: "Odjava",
    noTenant: "Tvoj nalog nije povezan ni sa jednim salonom.",
  },
  calendar: {
    weekdaysShort: ["pon", "uto", "sre", "čet", "pet", "sub", "ned"],
    months: [
      "januar",
      "februar",
      "mart",
      "april",
      "maj",
      "jun",
      "jul",
      "avgust",
      "septembar",
      "oktobar",
      "novembar",
      "decembar",
    ],
    noWorkingHours: "Radno vreme još nije uneto.",
  },
} as const;
