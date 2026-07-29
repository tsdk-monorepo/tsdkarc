import fs from 'fs/promises';
import path from 'path';
import { getFieldsMap } from './npm-publish-fields.mjs';

async function purgePkg(targetFolder) {
  const pkgPath = path.join(targetFolder, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    const json = JSON.parse(content);
    const whiteFieldsMap = getFieldsMap();

    Object.keys(json).forEach((key) => {
      if (!whiteFieldsMap[key.toLowerCase()]) {
        delete json[key];
      }
    });

    await fs.writeFile(pkgPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`✅ 成功清理: ${pkgPath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`❌ 错误: 在 "${targetFolder}" 目录下未找到 package.json`);
    } else {
      console.error(`❌ 处理 ${pkgPath} 时出错:`, error.message);
    }
    process.exit(1);
  }
}
const targetFolder = process.argv[2] || process.cwd();

purgePkg(targetFolder);