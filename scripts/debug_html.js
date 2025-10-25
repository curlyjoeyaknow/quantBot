const fs = require('fs');
const path = require('path');

// Debug script to understand HTML structure
function debugHTML() {
  const filePath = path.join('./messages', 'messages17.html');
  const content = fs.readFileSync(filePath, 'utf-8');
  
  console.log('Total content length:', content.length);
  
  // Check for message patterns
  const messagePatterns = [
    /<div class="message default clearfix[^"]*" id="message(\d+)">/g,
    /<div class="message default clearfix" id="message(\d+)">/g,
    /id="message(\d+)"/g
  ];
  
  messagePatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    console.log(`Pattern ${index + 1} matches:`, matches ? matches.length : 0);
    if (matches && matches.length > 0) {
      console.log('First few matches:', matches.slice(0, 3));
    }
  });
  
  // Look for specific content
  const memeworldorderMatches = content.match(/meme world order/g);
  console.log('meme world order mentions:', memeworldorderMatches ? memeworldorderMatches.length : 0);
  
  const addressMatches = content.match(/0x[a-fA-F0-9]{40}/g);
  console.log('EVM addresses found:', addressMatches ? addressMatches.length : 0);
  if (addressMatches) {
    console.log('Sample addresses:', addressMatches.slice(0, 3));
  }
  
  // Try a different approach - look for specific message
  const specificMessage = content.match(/0x49fb8ad7578148E17c3eF0C344CE23A66ed372C4[\s\S]*?meme world order[\s\S]*?<\/div>/);
  console.log('Found specific message:', specificMessage ? 'Yes' : 'No');
  
  if (specificMessage) {
    console.log('Message content preview:', specificMessage[0].substring(0, 200));
  }
}

debugHTML();
