import { db } from './src/db.js';

async function checkSchema() {
    const data = await db.fetchData('Ventas');
    if (data.length > 0) {
        console.log('Ventas columns:', Object.keys(data[0]));
    } else {
        console.log('No data in Ventas');
    }
}

checkSchema();
