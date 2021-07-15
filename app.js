'use strict';
const cheerio = require('cheerio');
const axios = require('axios');
const fastq = require('fastq');
const {writeFileSync} = require('fs');
const {join} = require('path');

const domain = process.argv[2];
const domainReg = new RegExp(`^https?:\/\/${domain.replace('.', '\.')}`);

let results = {
  '4xx': [],
  '5xx': []
};
let crawled = 0;
let known = ['', '#'];

let lastEmptyTime = 0;

/**
 * Adds an url to the crawling queue
 * @param referrer
 * @param url
 */
const addURLToQueue = (referrer, url = '') => {
  if (url.match(/^\//)) {
    url = url.replace(/^\//, `https://${domain}/`);
  }
  if (!known.includes(url.trim()) && url.trim().match(domainReg) !== null && url.trim().match(/^javascript/) === null) {
    known.push(url)
    crawlQueue.push({referrer, url});
  }
};

/**
 * Extract urls from a page
 * @param data
 * @returns {Promise<void>}
 */
const extractURLs = async (data) => {
  const $ = cheerio.load(data.content);

  $('a[href], link[href]').each((i, el) => {
    addURLToQueue(data.url, el.attribs.href);
  });
  $('img[src], script[src]').each((i, el) => {
    addURLToQueue(data.url, el.attribs.src);
  });
}

/**
 * Store the results to the result var
 * @param referrer
 * @param url
 * @param response
 */
const storeResult = (referrer, url, response) => {
  const statusType = Math.floor(response.status/100) +'xx';
  const result = {
    url,
    referrer,
    status: response.status
  };

  results[statusType] = results[statusType] || [];
  results[response.status] = results[response.status] || [];
  results[statusType].push(result);
  results[response.status].push(result)
};

/**
 * Crawl an URL
 * @param data
 * @returns {Promise<AxiosResponse<any>>}
 */
const crawl = (data) => {
  return axios.get(data.url)
    .catch(error => {
      if (error.response) {
        storeResult(data.referrer, data.url, error.response);
      } else if (error.request) {
        console.log(data.url, 'error.request', error.request);
      } else {
        console.log(data.url, 'error.message', error.message);
        throw error;
      }
    })
    .then(response => {
      if (response) {
        return extractURLsQueue.push({url: data.url, referrer: data.referrer, content: response.data});
      }
    })
    .catch(error => {
      console.log('ERROR ON URL', data.url);
      throw error;
    })
    .then(() => {
      crawled++;
      // reports to console
      console.log(crawled, 'URLs crawled so far.', crawlQueue.length(), 'URLs to be crawled.', `[4xx] ${results['4xx'].length}`, `[5xx] ${results['5xx'].length}`);
    });
};

/**
 * Store the data to a json file and exit the process
 */
const storeAndExit = () => {
  const fileName = join(__dirname, 'reports', domain + '.json');
  writeFileSync(fileName, JSON.stringify(results));
  console.log('Data stored at', fileName);
  process.exit(0);
};

/**
 * Check if the process has been finished yet
 */
const endProcess = () => {
    if (lastEmptyTime === 0) {
      if (crawlQueue.length() === 0 && extractURLsQueue.length() === 0 && crawled > 0) {
        console.log('About to end...');
        lastEmptyTime = Date.now();
      }
      setTimeout(endProcess, 5000);
    } else {
      if (crawlQueue.length() === 0 && extractURLsQueue.length() === 0) {
        console.log('Work done: saving data...');
        storeAndExit();
      } else {
        console.log('No end for this time...');
        lastEmptyTime = 0;
        setTimeout(endProcess, 5000);
      }
    }
}

// Create the queues
const crawlQueue = fastq.promise(crawl, 4);
const extractURLsQueue = fastq.promise(extractURLs, 15);

// handle manual process end
process.on('SIGINT', () => {
  console.log('Manual interruption: saving data...');
  crawlQueue.kill();
  extractURLsQueue.kill();
  storeAndExit();
});

// push the first URL to crawl to start the process
crawlQueue.push({referrer: '', url: 'https://' + domain + '/'});
// launch the "has the process ended yet" mechanism
endProcess();