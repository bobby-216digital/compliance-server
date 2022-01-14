const express = require('express')
const csv = require('csvtojson')
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const app = express()
const port = process.env.PORT || 3000
const waveURL = 'https://wave.webaim.org/api/request?key=14PTpkpK1992&reporttype=4&url='

app.use(fileUpload({
    useTempFiles : true,
    tempFileDir : '/tmp/'
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

async function lighthouseScan (url) {
    const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
    const options = {logLevel: 'info', output: 'json', onlyCategories: ['accessibility'], onlyAudits: ['accessibility'], port: chrome.port};
    const runnerResult = await lighthouse(url, options);

    let date = Date.now();

    let query = `mutation NewLighthouseScan {
        addLighthouseScan(input: [
          {
            site: {url: "` + url + `"},
            date: ` + date + `,
            score: ` + (runnerResult.lhr.categories.accessibility.score * 100) +`
          }
        ]) {
          numUids
          lighthouseScan {
              site {
                  url
              }
              date
              score
          }
        }
      }`

      doFetch(query);

      console.log((runnerResult.lhr.categories.accessibility.score * 100));
  
    await chrome.kill();
}

function waveScan (url) {
    fetch(waveURL + url, {
        method: 'GET',
      })
        .then(r => r.json())
        .then(data => {

            const scan = data;
            let date = Date.now();
            let query = `mutation NewWaveScan {
                addWaveScan(input: [
                  {
                    site: {url: "` + url + `"},
                    date: ` + date + `,
                    issues: []
                  }
                ]) {
                  numUids
                  waveScan {
                      site {
                          url
                      }
                      date
                  }
                }
              }`

              doFetch(query, false);

              setTimeout(() => {
                let queryString = ``;

                let items = scan.categories.error.items;

                for (x in items) {

                    queryString += `
                        addWaveIssue(
                            input:
                            [
                                {
                                    description: "` + items[x].description + `"
                                    priority: 1
                                    count: ` + items[x].count + `
                                    scan: {
                                        date: ` + date + `
                                    }
                                }
                            ]
                        ) {
                            numUids
                        }
                        `
                }

                query = `
                    mutation NewWaveIssue {
                        ` + queryString + `
                    }
                `
                doFetch(query, false)
              }, 3000)
        })
}

//get all site data

app.get('/site/:slug', function (req, res) {
    const query = `
    query MyQuery {
        querySite(filter: {slug: {allofterms: "` + req.params.slug + `"}}) {
          freq
          slug
          url
          wcag
          lighthouse {
            score
          }
          sortsite {
            date
            issues {
              count
              priority
              guideline
            }
          }
          wave {
            issues {
              count
              description
              priority
            }
          }
        }
      }
    `

    doFetch(query, res)
})

//get a list of sites that have outstanding scans

app.get('/sortsite', function (req, res) {
    const now = Date.now();
    const day = 86400000;
    const query = `
    query MyQuery {
        querySite {
          freq
          url
          sortsite(order: {desc: date}, first: 1) {
            date
          }
        }
      }
    `

    fetch('https://patient-hill.us-west-2.aws.cloud.dgraph.io/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          query
        })
      })
        .then(r => r.json())
        .then(data => {
            let result = data.data.querySite;
            let returnObj = {
                urls: []
            };
            result.map((x) => {
                if (x.sortsite[0]) {
                    if (x.sortsite[0].date < (now - (x.freq * day))) {
                        returnObj.urls.push(x.url);
                    } 
                } else {
                    returnObj.urls.push(x.url);
                }
                
            })
            res.send(returnObj)
        })
        .catch(error => {
            console.log(error)
        })
})

//onboard a site

app.post('/new', function(req, res) {
    //construct the gql query
    const query = `mutation NewSite {
            addSite(input: [
              {
                url: "` + req.body.url + `",
                freq: ` + req.body.freq + `,
                slug: "` + req.body.slug + `",
                sortsite: []
              }
            ]) {
              numUids
              site {
                url
              }
            }
          }`
          
    
    doFetch(query, res);
})

app.post('/auth', function(req, res) {
  //construct the gql query
  
  let pass = "216Digital1!"

  console.log(req.body)

  res.set('Access-Control-Allow-Origin',  'http://localhost:3000')
 
  if (req.body.key == pass) {
    res.send("Authed")
  } else {
    res.send("Incorrect admin password")
  }
})

//add a scan

app.post('/scan', function(req, res) {
    if (req.files) {
        file = req.files.scanData;

        csv()
        .fromFile(file.tempFilePath)
        .then((jsonObj)=>{
            //this is async, have to call function to pass data
            createQuery(jsonObj);
        })
        .catch(error => {
            res.status(400);
            console.log(error)
        })

        function createQuery(jsonObj) {
            let scanJson = jsonObj;

            let scanDate = Date.now();

            let query = `mutation NewSortsiteScan {
                addSortsiteScan(
                    input: 
                    [
                    {
                        date: "` + scanDate + `"
                        site: {
                        url: "` + req.body.site + `"
                        }
                    }
                    ]
                ) {
                    numUids
                    sortsiteScan {
                    site {
                        url
                    }
                    date
                    }
                }
                }`

            doFetch(query);

            let internalIssueQuery = ``;

            for(let i = 0; i < scanJson.length; i++) {

                if (scanJson[i]["Category"] == "Accessibility") {
                    //create comma delimited line string
                    let lineNumbers = scanJson[i]["Line"].slice(2);
                    let lineLength = lineNumbers.length - 1;
                    lineNumbers = lineNumbers.slice(0, lineLength);
                    lineArray = lineNumbers.split(' ');
                    cleanedLineArray = lineArray.join(', ');
                    cleanedLineArray = cleanedLineArray.substring(0, cleanedLineArray.length - 2)

                    internalIssueQuery += `
                        addSortsiteIssue(
                            input:
                            [
                                {
                                guideline: "` + scanJson[i]["Guidelines"] + `"
                                priority: ` + scanJson[i]["Priority"] + `
                                count: ` + scanJson[i]["Count"] + `
                                url: "` + scanJson[i]["URL"] + `"
                                line: [` + cleanedLineArray + `]
                                scan: {
                                    date: "` + scanDate + `"
                                }
                                }
                            ]
                        ) {
                            numUids
                        }
                    `
                }

            }
            let issueQuery = `mutation NewSortSiteIssues {
                ` + internalIssueQuery + `
            }`;
            
            doFetch(issueQuery);

            res.send("Complete.")
        }

        waveScan(req.body.site);

        lighthouseScan(req.body.site)
    } else {
        res.status(400);
        res.send("Bad Request")
    }
    
})

//interact with GQL

function doFetch (query, res) {
     //perform the HTTP request
     fetch('https://patient-hill.us-west-2.aws.cloud.dgraph.io/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query
        })
      })
        .then(r => r.json())
        .then(data => {
            if (res) {
                res.set('Access-Control-Allow-Origin',  'http://localhost:3000')
                res.send(data)
            }
           
        })
        .catch(error => {
            console.log(error)
        })
}

app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`)
})