import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';

async function checkSept10Calls() {
  const tokens = [
    {
      address: '2cxnk5oK5UG6e9b3JDftgKzzJ72nRdie5ZxHrspLpump',
      chain: 'solana',
      time: '2025-09-09T14:06:05.000Z',
      name: 'Call 1',
    },
    {
      address: '76rTxzztXjJe7AUaBi7jQ5J61MFgpQgB4Cc934sWbonk',
      chain: 'solana',
      time: '2025-09-10T00:03:18.000Z',
      name: 'Call 2',
    },
    {
      address: '5Qw7bkvj13Atg1ftzUKrQu9p7YrDiQmJTrhwchM1pump',
      chain: 'solana',
      time: '2025-09-10T03:30:39.000Z',
      name: 'Call 3',
    },
    {
      address: 'd6bmarrdvaqxmwp9txfgqb4aor93s126h',
      chain: 'solana',
      time: '2025-09-10T09:50:58.000Z',
      name: 'Call 4',
    },
    {
      address: '6q4Ze3r8UnxiHHxz9yQyrFQYMMhPTeJNdZuzumn8pump',
      chain: 'solana',
      time: '2025-09-10T13:43:42.000Z',
      name: 'Call 5',
    },
  ];

  console.log('🔍 Checking all Brook 💀🧲 calls from September 10, 2025...\n');

  for (const token of tokens) {
    const alertDate = DateTime.fromISO(token.time);
    const endDate = alertDate.plus({ days: 60 });

    console.log(`\n${token.name} - ${alertDate.toFormat('yyyy-MM-dd HH:mm')}`);
    console.log(`Token: ${token.address.substring(0, 30)}...`);

    try {
      const candles = await fetchHybridCandles(token.address, alertDate, endDate, token.chain);

      if (!candles || candles.length === 0) {
        console.log('❌ No candles');
        continue;
      }

      const entryPrice = candles[0].close;
      let maxMultiplier = 1.0;

      for (const candle of candles) {
        const multiplier = candle.high / entryPrice;
        if (multiplier > maxMultiplier) {
          maxMultiplier = multiplier;
        }
      }

      const finalMultiplier = candles[candles.length - 1].close / entryPrice;

      console.log(`   Entry: $${entryPrice.toFixed(8)}`);
      console.log(`   Max: ${maxMultiplier.toFixed(2)}x`);
      console.log(`   Final: ${finalMultiplier.toFixed(2)}x`);

      if (maxMultiplier > 50) {
        console.log(`   🚀 BIG WINNER!`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

checkSept10Calls().catch(console.error);
