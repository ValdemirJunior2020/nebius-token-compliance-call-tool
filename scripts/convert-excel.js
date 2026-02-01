import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const files = [
  { input: 'client/public/qa-voice.xlsx', output: 'server/data/qa-voice.json', name: 'QA Voice' },
  { input: 'client/public/qa-group.xlsx', output: 'server/data/qa-group.json', name: 'QA Groups' },
  { input: `client/public/Service Matrix's 2026.xlsx`, output: 'server/data/service-matrix.json', name: 'Service Matrix' }
];

files.forEach(({ input, output, name }) => {
  try {
    if (!fs.existsSync(input)) {
      console.log(`❌ Missing: ${input}`);
      return;
    }
    
    // Read Excel
    const workbook = xlsx.readFile(input);
    const result = {};
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      // Convert to array of objects (better for JSON)
      result[sheetName] = xlsx.utils.sheet_to_json(sheet);
    });
    
    // Ensure data directory exists
    const dir = path.dirname(output);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Write JSON
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(`✅ Converted: ${name} -> ${output}`);
    
  } catch (err) {
    console.error(`❌ Error with ${name}:`, err.message);
  }
});

console.log('\n🎉 Done! You can now start the server.');