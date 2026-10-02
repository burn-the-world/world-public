// Audit rendered string literals, resource parity, and intentionally retained source documents.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
const zh=JSON.parse(read('src/locales/zh-CN.json')),en=JSON.parse(read('src/locales/en.json'))
const han=/\p{Script=Han}/u
const files=directory=>fs.readdirSync(path.join(root,directory),{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(directory+'/'+item.name):[directory+'/'+item.name])
const hardcoded=[],workerMessages=[]
for(const file of [...files('src').filter(file=>/\.[jt]sx?$/.test(file)),...files('worker').filter(file=>/\.ts$/.test(file))]){
 const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
 const visit=node=>{
  if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node))&&han.test(node.text)){
   const line=source.getLineAndCharacterOfPosition(node.getStart()).line+1
   const intentional=file==='src/LanguageSwitch.tsx'&&node.text==='中文'
   hardcoded.push({file,line,text:node.text,classification:intentional?'有意保留：语言切换控件的中文自称':'应迁移到 i18n'})
  }
  if(file.startsWith('worker/')&&ts.isCallExpression(node)&&node.expression.getText(source)==='failure'&&ts.isStringLiteral(node.arguments[2]))workerMessages.push({line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,text:node.arguments[2].text,classification:'有意保留：JSON-RPC 边界诊断；DApp 展示中英文友好错误，不改代理协议或策略'})
  if(file.startsWith('worker/')&&ts.isNewExpression(node)&&node.expression.getText(source)==='Response'&&node.arguments&&ts.isStringLiteral(node.arguments[0]))workerMessages.push({line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,text:node.arguments[0].text,classification:'有意保留：HTTP 边界诊断；DApp 展示中英文友好错误'})
  ts.forEachChild(node,visit)
 };visit(source)
}
const linkedDocs=new Set([...read('src/App.tsx').matchAll(/href="\.\/docs\/([^"?]+\.md)"/g)].map(match=>'public/docs/'+match[1]))
const documents=files('public').filter(file=>/\.(md|html|txt)$/.test(file)&&han.test(read(file))).map(file=>({file,chineseLines:read(file).split(/\r?\n/).filter(line=>han.test(line)).length,classification:linkedDocs.has(file)?'应迁移：UI 公开文档必须为英文':'有意保留：未被当前 UI 链接的历史报告或原始证明；不得改写证据'}))
const nonEnglishLinkedDocs=documents.filter(item=>linkedDocs.has(item.file))
const parity=Object.keys(zh).every(key=>typeof en[key]==='string'&&JSON.stringify(zh[key].match(/{{.*?}}/g)?.sort()??[])===JSON.stringify(en[key].match(/{{.*?}}/g)?.sort()??[]))&&Object.keys(zh).length===Object.keys(en).length
const englishChinese=Object.entries(en).filter(([key,text])=>han.test(text)&&key!=='languageChinese')
const report={resourceEntries:Object.keys(zh).length,resourceParity:parity,hardcoded,documents,workerMessages,unmigrated:hardcoded.filter(item=>item.classification.startsWith('应迁移')),englishChinese,nonEnglishLinkedDocs}
const reportPath=path.resolve(root,process.env.WORLD_LANGUAGE_AUDIT_OUTPUT||'test-results/i18n-language-audit.json')
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({resourceEntries:report.resourceEntries,parity,remainingSystemChinese:report.unmigrated.length,intentionalAutonyms:hardcoded.length,retainedChineseDocuments:documents.length,nonEnglishLinkedDocs:nonEnglishLinkedDocs.length,workerBoundaryMessages:workerMessages.length}))
if(!parity||report.unmigrated.length||englishChinese.length||nonEnglishLinkedDocs.length)process.exitCode=1
