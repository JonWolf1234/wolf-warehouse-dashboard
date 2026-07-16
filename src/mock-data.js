function isoFromNow(days, hour = 8) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function mockJobs() {
  return [
    {
      id: 10001,
      reference: "ORD-2418",
      name: "Sandbanks Beach Event",
      customer: "Example Events Ltd",
      status: "Confirmed",
      type: "Order",
      totalItems: 286,
      preparedItems: 286,
      preparedPercent: 100,
      prepDataQuality: "exact",
      prepAt: isoFromNow(1, 8),
      loadAt: isoFromNow(2, 6),
      returnAt: isoFromNow(4, 10),
      currentRmsUrl: null
    },
    {
      id: 10002,
      reference: "ORD-2421",
      name: "Corporate Awards Dinner",
      customer: "Example Corporate Client",
      status: "Confirmed",
      type: "Order",
      totalItems: 148,
      preparedItems: 96,
      preparedPercent: 65,
      prepDataQuality: "exact",
      prepAt: isoFromNow(2, 9),
      loadAt: isoFromNow(3, 12),
      returnAt: isoFromNow(4, 2),
      currentRmsUrl: null
    },
    {
      id: 10003,
      reference: "ORD-2426",
      name: "Outdoor Music Festival",
      customer: "Festival Production Ltd",
      status: "Provisional",
      type: "Order",
      totalItems: 412,
      preparedItems: 42,
      preparedPercent: 10,
      prepDataQuality: "status-derived",
      prepAt: isoFromNow(3, 8),
      loadAt: isoFromNow(4, 5),
      returnAt: isoFromNow(7, 12),
      currentRmsUrl: null
    },
    {
      id: 10004,
      reference: "ORD-2430",
      name: "Theatre Lighting Hire",
      customer: "Example Theatre",
      status: "Confirmed",
      type: "Order",
      totalItems: 73,
      preparedItems: 0,
      preparedPercent: 0,
      prepDataQuality: "exact",
      prepAt: isoFromNow(6, 10),
      loadAt: isoFromNow(7, 15),
      returnAt: isoFromNow(14, 11),
      currentRmsUrl: null
    }
  ];
}
