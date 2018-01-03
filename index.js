const { URL } = require('url');
const fs = require('fs');
const TurndownService = require('turndown');
const turndownService = new TurndownService({
  codeBlockStyle: 'fenced',
  fence: '```'
})

turndownService.addRule('fencedCodeBlock', {
  filter: function (node, options) {
    return (
      options.codeBlockStyle === 'fenced' &&
      node.nodeName === 'PRE' &&
      (
        (node.firstChild && node.firstChild.nodeName === 'CODE') || (node.className === 'prettyprint')
      )
    )
  },

  replacement: function (content, node, options) {
    var className = node.firstChild.className || node.className || ''
    var language = (className.match(/language-(\S+)/) || [null, ''])[1]

    return (
      '\n\n' + options.fence + language + '\n' +
      node.firstChild.textContent +
      '\n' + options.fence + '\n\n'
    )
  }
});

const fetch = require('node-fetch');
const path = require('path');
const moment = require('moment');
const mkdirp = require('mkdirp');

const exportFilePath = process.argv[2];
const sourceDir = process.argv[3];
const argv = require('minimist')(process.argv.slice(4));
const host = argv.host;
const assets = argv.assets || 'assets';
const rootPath = argv.rootPath || '/blog/';
const skipDraft = argv.skipDraft;

if (!exportFilePath) {
  throw new Error('The Export file path is required');
}

if (!sourceDir) {
  throw new Error('The source directory is required');
}

(new Promise((fulfill, reject) => {
  fs.exists(exportFilePath, (exists) => {
    if (!exists) {
      reject(new Error('File does not exist'));
      return;
    }
    fs.readFile(exportFilePath, {
      encoding: 'utf8'
    }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      fs.exists(sourceDir, (exists) => {
        if (!exists) {
          reject(new Error('Source directory does not exist'));
          return;
        }
        fs.exists(`${sourceDir}/${assets}`, (exists) => {
          if (!exists) {
            fs.mkdirSync(`${sourceDir}/${assets}`);
          }
          fulfill(data);
        })
      });
    });
  });
})).then(async (data)=>{
  const posts = data.split('--------');
  
  const generatePostFile = (post) => {
    return new Promise((fulfill, reject) => {
      const [meta, body, extended, excerpt, keywords] = post.split('-----');
      let metaData = meta.replace(/^\n/, '');
      metaData = meta.split(/\n/);
      const metaDataHash = {};
      metaData.forEach((m) => {
        const mData = m.split(':');
        const value = mData.slice(1).join(':').trim();
        if (mData[0] === 'CATEGORY') {
          metaDataHash[mData[0]] = metaDataHash[mData[0]] || [];
          metaDataHash[mData[0]].push(value);
        } else {
          metaDataHash[mData[0]] = value;
        }
      });
      const date = moment(metaDataHash['DATE'] || '');
      const status = metaDataHash['STATUS'] === 'Publish' ? '_posts' : '_drafts';

      if (status === '_drafts' && skipDraft) {
        fulfill();
        return;
      }

      const statusDir = `${__dirname}/${sourceDir}/${status}`;

      const dist = `${statusDir}/${date.format('YYYY/MM')}`;
      const basename = metaDataHash['BASENAME'];
      if (!basename) {
        fulfill();
        return;
      }

      const fetchImage = (urlStr) => {
        return new Promise((fulfill, reject) => {
          fetch(urlStr).then(res => {
            const url = new URL(urlStr);
            const filename = path.basename(urlStr);
            const dirname = path.dirname(url.pathname);
            const fileDir = `${__dirname}/${sourceDir}/${assets}${dirname}`;
            const filePath = `${fileDir}/${filename}`;
            mkdirp(fileDir, (err) => {
              const dest = fs.createWriteStream(filePath);
              res.body.pipe(dest);
              fulfill();
            })
          });
        });
      }    

      const filePath = `${dist}/${basename}.md`;
      mkdirp(dist, (err) => {
        if (err) {
          reject(err);
          return;  
        }
        fs.exists(filePath, (exists) => {
          if (exists) {
            // Skip file
            fulfill();
            return;
          }

          let hexoData = '---\n';
          const title = (metaDataHash['TITLE'] || '')
            .replace(/:/g, '&#x3a;')
            .replace(/%/g, '&#x25;');
          
          hexoData += `title: ${title}\n`;
          hexoData += `date: ${date.toISOString()}\n`;
          const categories = metaDataHash['CATEGORY'] || [];
          if (categories.length) {
            hexoData += 'categories:\n';
            hexoData += categories.map(cat => `- ${cat}`).join('\n') + '\n';
          }
          const tasData = metaDataHash['TAGS'] || '';
          if (tasData.length) {
            const tags = (metaDataHash['TAGS'] || '').split(',');
            hexoData += 'tags:\n';
            hexoData += tags.map(tag => `- ${tag}`).join('\n') + '\n';
          }

          hexoData += '---\n';

          const replaceHostedURL = (str) => {
            const reg = new RegExp(`https?:\/\/${host}(\/[^\\s^"]*?)\\.(html?|jpe?g|png|gif|php)`, 'g');
            return str.replace(reg, (urlStr, urlPath, ext) => {
              if (/(htm?)l|(php)/.test(ext)) {
                return `${rootPath}${urlPath}/`;
              } else {
                fetchImage(urlStr);
                const url = new URL(urlStr);
                const filename = path.basename(urlStr);
                const dirname = path.dirname(url.pathname);
                const filePath = `${rootPath}/${assets}${dirname}/${filename}`;
                return filePath
              }
            });
          }

          let bodyStr = body.replace(/BODY:[\n]?/, '');
          bodyStr = replaceHostedURL(bodyStr);
          bodyStr = turndownService.turndown(bodyStr).replace(/\%/g, '&#x25;');

          let extendedStr = (extended.replace(/EXTENDED BODY:[\n]?/, '') || '').trim();
          if (extendedStr.length) {
            extendedStr = replaceHostedURL(extendedStr);            
            extendedStr = turndownService.turndown(extendedStr).replace(/\%/g, '&#x25;');

            hexoData += bodyStr;
            hexoData += '\n<!-- more -->\n';
            hexoData += extendedStr;
          } else {
            let count = 0;
            let isMoreAdded = false;  
            bodyStr.split(/\n/).forEach((b)=>{
              hexoData += `${b}\n`;
              count += b.length;
              if (!isMoreAdded && count > 100) {
                hexoData += '\n<!-- more -->\n';
                isMoreAdded = true;
              }
            });
          }

          fs.writeFile(filePath, hexoData, (err) => {
            if (err) {
              reject(err);
              return;
            }
            fulfill();
          });  
        });
      }); 
    });
  };

  for (const post of posts) {
    try {
      await generatePostFile(post);
    } catch (err) {
      console.log(err);
      break;
    }
  }
});