import fs from 'fs';
import path from 'path';

const htmlPath = '/Users/nam088/code/nam088/json-logic-to-sql-v2/public/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');

const scriptRegex = /<script>([\s\S]*?)<\/script>/;
const match = html.match(scriptRegex);

if (match && match[1]) {
  let jsCode = match[1];
  // Add mock definitions to make it valid TypeScript/JavaScript for validation
  const mocks = `
    // Mock definitions
    let schema: any = {};
    const document: any = {
      getElementById: (id: string) => ({
        addEventListener: (event: string, callback: Function) => {},
        appendChild: (child: any) => {},
        querySelector: (selector: string) => ({ value: '', checked: false }),
        innerText: '',
        style: { display: '' }
      }),
      querySelector: (selector: string) => ({
        value: '',
        querySelector: (selector: string) => ({ value: '', checked: false }),
        remove: () => {}
      }),
      querySelectorAll: (selector: string) => [],
      createElement: (tag: string) => ({
        className: '',
        id: '',
        innerHTML: '',
        querySelector: (selector: string) => ({
          value: '',
          checked: false,
          addEventListener: (event: string, callback: Function) => {}
        }),
        appendChild: (child: any) => {},
        remove: () => {}
      })
    };
    const window: any = {
      addEventListener: (event: string, callback: Function) => {}
    };
    const fetch: any = (url: string, options?: any) => Promise.resolve({
      json: () => Promise.resolve({ success: true, schema: {}, data: { sql: '', params: [], rows: [] } })
    });
  `;
  
  // Clean up re-declarations if any
  jsCode = jsCode.replace(/let schema = {};/, '');
  jsCode = jsCode.replace(/document\.getElementById/g, 'mockDocument.getElementById');
  
  const outputCode = `
    const mockDocument = ${JSON.stringify({
      getElementById: () => ({ addEventListener: () => {} })
    })};
    ${mocks}
    ${jsCode}
  `;
  
  fs.writeFileSync('/Users/nam088/code/nam088/json-logic-to-sql-v2/scratch/test-script.ts', outputCode, 'utf8');
  console.log('Extracted script to scratch/test-script.ts');
} else {
  console.error('Could not find script tag');
}
