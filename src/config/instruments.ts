const instruments: Record<string, { contractSize: number; digits: number }> = {
  EURUSD: { contractSize: 100000, digits: 5 },
  GBPUSD: { contractSize: 100000, digits: 5 },
  USDJPY: { contractSize: 100000, digits: 3 },
  XAUUSD: { contractSize: 100, digits: 2 },
  BTCUSD: { contractSize: 1, digits: 2 },
};

export default instruments;
