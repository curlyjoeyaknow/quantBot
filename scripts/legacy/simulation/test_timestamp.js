function parseTimestamp(timestampStr) {
    try {
        const cleanTimestamp = timestampStr.replace(/"/g, '');
        console.log('Clean timestamp:', cleanTimestamp);
        
        const parts = cleanTimestamp.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/);
        console.log('Parts:', parts);
        
        if (parts) {
            const [, day, month, year, hour, minute, second, tzSign, tzMinute] = parts;
            const isoString = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + tzSign + ':' + tzMinute;
            console.log('ISO string:', isoString);
            const date = new Date(isoString);
            console.log('Parsed date:', date);
            console.log('Is valid:', !isNaN(date.getTime()));
            return date;
        }
        
        return new Date(cleanTimestamp);
    } catch (e) {
        console.warn('Error:', e.message);
        return null;
    }
}

const testTimestamp = '01.09.2025 00:43:48 UTC+10:00';
console.log('Testing timestamp:', testTimestamp);
const result = parseTimestamp(testTimestamp);
console.log('Result:', result);
