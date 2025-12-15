#!/usr/bin/env tsx

import { CallsRepository, AlertsRepository, CallersRepository } from '@quantbot/storage';

async function checkDuplicates() {
  const callsRepo = new CallsRepository();
  const alertsRepo = new AlertsRepository();
  const callersRepo = new CallersRepository();

  // Get all calls and check for duplicates
  const allCalls = await callsRepo.findAll();
  console.log('Total calls:', allCalls.length);

  // Get all callers
  const callers = await callersRepo.findAll();
  console.log('Total callers:', callers.length);
  callers.forEach(c => console.log('  -', c.name, '(id:', c.id + ')'));

  // Check for duplicate calls (same token, same timestamp)
  const duplicates = new Map<string, typeof allCalls>();
  allCalls.forEach(call => {
    const key = `${call.tokenId}-${call.signalTimestamp.toISO()}`;
    if (!duplicates.has(key)) {
      duplicates.set(key, []);
    }
    duplicates.get(key)!.push(call);
  });

  const dupGroups = Array.from(duplicates.values()).filter(arr => arr.length > 1);
  console.log('\nDuplicate groups found:', dupGroups.length);

  if (dupGroups.length > 0) {
    console.log('\nSample duplicates:');
    dupGroups.slice(0, 10).forEach(arr => {
      console.log(`  Token ${arr[0].tokenId}, Time ${arr[0].signalTimestamp.toISO()}: ${arr.length} duplicates`);
      arr.forEach((call, idx) => {
        console.log(`    [${idx + 1}] Call ID: ${call.id}, Caller ID: ${call.callerId}`);
      });
    });
  }

  // Check alerts too
  const allAlerts = await alertsRepo.findAll();
  console.log('\nTotal alerts:', allAlerts.length);

  const alertDuplicates = new Map<string, typeof allAlerts>();
  allAlerts.forEach(alert => {
    const key = `${alert.tokenId}-${alert.alertTimestamp.toISO()}`;
    if (!alertDuplicates.has(key)) {
      alertDuplicates.set(key, []);
    }
    alertDuplicates.get(key)!.push(alert);
  });

  const alertDupGroups = Array.from(alertDuplicates.values()).filter(arr => arr.length > 1);
  console.log('Duplicate alert groups found:', alertDupGroups.length);

  if (alertDupGroups.length > 0) {
    console.log('\nSample duplicate alerts:');
    alertDupGroups.slice(0, 5).forEach(arr => {
      console.log(`  Token ${arr[0].tokenId}, Time ${arr[0].alertTimestamp.toISO()}: ${arr.length} duplicates`);
    });
  }
}

checkDuplicates().catch(console.error);

