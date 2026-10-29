// Founding-client program shown on the public home page. TEXT ONLY: no live counter, because a counter
// would have to read a real server-side count and nothing here may claim a number that is not true.
// Owner decisions (2026-10-05): 5 testing clients at 50% off for 12 months, 10 free founding spots under
// written terms. The program closes when the spots are filled or at 10,000 clients; today the owner
// closes it by hand (set `enabled` to false). Turn it off here to remove the whole section.
// Nothing is charged or discounted automatically: billing is not connected yet.
export const foundingProgram = {
  enabled: true,
  testerSpots: 5,
  testerDiscountPercent: 50,
  testerMonths: 12,
  freeSpots: 10,
  closesAtClients: 10_000,
  applySubject: "Founding client application",
};
