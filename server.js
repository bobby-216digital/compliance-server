const express = require('express')
const csv = require('csvtojson')
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const app = express()
const port = process.env.PORT || 3000
const waveURL = 'https://wave.webaim.org/api/request?key=14PTpkpK1992&reporttype=4&url=';
const mailchimp = require('@mailchimp/mailchimp_transactional')("jpuLHp55BIqZl1mhARF3EA");
const frontURL = "https://a11yradar.com/";

app.use(fileUpload({
    useTempFiles : true,
    tempFileDir : '/tmp/'
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  // handle OPTIONS method
  if ('OPTIONS' == req.method) {
      return res.sendStatus(200);
  } else {
      next();
  }
});

async function lighthouseScan (url) {
    const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
    const options = {logLevel: 'info', output: 'json', onlyCategories: ['accessibility'], onlyAudits: ['accessibility'], port: chrome.port};
    const runnerResult = await lighthouse(url, options).then((x) => {
      let date = Date.now();

      let query = `mutation NewLighthouseScan {
          addLighthouseScan(input: [
            {
              site: {url: "` + url + `"},
              date: ` + date + `,
              score: ` + (x.lhr.categories.accessibility.score * 100) +`
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

        console.log((x.lhr.categories.accessibility));
    }
    )
    .catch((error) => {
      console.log(error)
    })

    
  
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
          thresholda
          thresholdaa
          passcode
          contacts
          lighthouse {
            score
          }
          sortsite {
            date
            issues
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
          newscan
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
                    if (x.sortsite[0].date < (now - (x.freq * day)) || x.newscan == true) {
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

//get list of sites
app.get('/sites', function (req, res) {
  const query = `
  query MyQuery {
      querySite {
        freq
        url
        slug
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
          res.send(data)
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
                contacts: "` + req.body.contacts + `",
                thresholda: "` + req.body.thresholda + `",
                thresholdaa: "` + req.body.thresholdaa + `",
                sortsite: []
              }
            ]) {
              numUids
              site {
                url
              }
            }
          }`
          
    onboard(req.body.slug, req.body.url, req.body.contacts)
    doFetch(query, res);
})

app.post('/auth', function(req, res) {
  let pass = "216Digital1!"

  console.log(req.body)


  if (req.body.key == pass) {
    res.status(200)
    res.send("Auth")
  } else {
    res.status(403)
    res.send("No Auth")
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

            let obj = {
              a: {},
              aa: {},
              aaa: {}
            };

            for(let i = 0; i < scanJson.length; i++) {

                if (scanJson[i]["Category"] == "Accessibility") {
                    //create comma delimited line string
                    let lineNumbers = scanJson[i]["Line"].slice(2);
                    let lineLength = lineNumbers.length - 1;
                    lineNumbers = lineNumbers.slice(0, lineLength);
                    lineArray = lineNumbers.split(' ');
                    cleanedLineArray = lineArray.join(', ');
                    cleanedLineArray = cleanedLineArray.substring(0, cleanedLineArray.length - 2)

                    let level;
                    if (scanJson[i]["Guidelines"].includes(" A ")) {
                      level = "a"
                    } else if (scanJson[i]["Guidelines"].includes(" AA ")) {
                      level = "aa"
                    } else (
                      level = "aaa"
                    )

                    if (!obj[level][scanJson[i]["Description"]]) {
                      obj[level][scanJson[i]["Description"]] = [];
                    }

                    obj[level][scanJson[i]["Description"]].push(
                      {
                        count: scanJson[i]["Count"],
                        url: scanJson[i]["URL"],
                        line: lineArray
                      }
                    )

                    


                }

            }

            let encoded = encodeURIComponent(JSON.stringify(obj));

            let query = `mutation NewSortsiteScan {
              addSortsiteScan(
                  input: 
                  [
                  {
                      date: "` + scanDate + `"
                      issues: "` + encoded + `"
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
                      slug
                      thresholda
                      thresholdaa
                      contacts
                  }
                  date
                  }
              }

              
              }`

          doFetch(query, res, true, obj)

          // query = `mutation MyMutation {
          //   updateSite(input: {filter: {url: {allofterms: "` + req.body.site + `}}, set: {newscan: false}}) {
          //     site {
          //       newscan
          //     }
          //   }
          // }`

          // doFetch(query, res)
        }

        waveScan(req.body.site);

        lighthouseScan(req.body.site);

        //checkThresholds(req.body.site, obj)
    } else {
        res.status(400);
        res.send("Bad Request")
    }
    
})

app.get('/mailtest', function(req, res) {
  checkThresholds();
})

app.post('/contact', function(req, res) {
  let contacts = [
    {
      email: "bobby@216digital.com",
      type: "to"
    },
    {
      email: "robby@216digital.com",
      type: "to"
    },
    {
      email: "gm@216digital.com",
      type: "to"
    }
  ]
  const run = async () => {
    const response = await mailchimp.messages.send({ message: {
      subject: "a11y.Radar Request",
      from_name: "a11y.Radar",
      from_email: "info@a11yradar.com",
      to: contacts,
      html: `Request from: ${req.body.url}<br/>Request type: ${req.body.type}<br/>Contact email: ${req.body.email}<br/>Phone number: ${req.body.phone}<br />Notes: ${req.body.notes}`
    } });
    console.log(response);
  };
  
  run();
  res.send(req.body)
})

app.post('/newscan', function(req, res) {
  let query = `mutation MyMutation {
    updateSite(input: {filter: {url: {eq: "` + req.body.url + `"}}, set: {newscan: true}}) {
      numUids
    }
  }
  `

  console.log(query);

  doFetch(query, res);
})

function onboard(slug, url, siteContacts) {
  let contacts = [];
  siteContacts.split(", ").map((x) => {
    contacts.push({
      email: x,
      type: "to"
    })
  })

  const run = async () => {
    const response = await mailchimp.messages.sendTemplate({
      template_name: "a11y-radar-onboarding",
      template_content: [{}],
      message: {
        subject: "Welcome to a11y.Radar!",
        from_name: "a11y.Radar",
        from_email: "info@a11yradar.com",
        to: contacts,
        global_merge_vars: [
          {
            "name": "DASH_URL",
            "content": frontURL + slug
          },
          {
            "name": "SITE_URL",
            "content": url
          }
        ],
      },
    });
    console.log(response);
  };

  run();
}

function checkThresholds(siteData, errorCounts) {
  let text = {
    title: "Congratulations!",
    textone: "The WCAG 2.1 AA error count on " + siteData.url + " is below your risk tolerance threshold!",
    texttwo: "Remember, keeping your error counts below your risk thresholds greatly reduces the threat of a frivolous ADA non-compliance lawsuit being filed against you. Our in-house accessibility experts are on deck to fix any remaining issues as soon as possible, or advise your internal development resources on what it will take to get back in bounds.",
    buttontext: "Get ahead of the game",
    errora: "",
    erroraa: ""
  }

  if (siteData.thresholda - 3 <= errorCounts[0] || siteData.thresholdaa - 3 <= errorCounts[1]) {
    text = {
      title: "Attention Required",
      textone: "The WCAG 2.1 AA error count on " + siteData.url + " is approaching your risk tolerance threshold.",
      texttwo: "Remember, keeping your error counts below your risk thresholds greatly reduces the threat of a frivolous ADA non-compliance lawsuit being filed against you. Our in-house accessibility experts are on deck to fix these issues as soon as possible, or advise your internal development resources on what it will take to get back in bounds.",
      buttontext: "Get back on track",
      errora: (siteData.thresholda <= errorCounts[0] ? "⚠️" : ""),
      erroraa: (siteData.thresholdaa <= errorCounts[1] ? "⚠️" : "")
    }
  }

  if (siteData.thresholda <= errorCounts[0] || siteData.thresholdaa <= errorCounts[1]) {
    text = {
      title: "Urgent Attention Required",
      textone: "The WCAG 2.1 AA error count on " + siteData.url + " has surpassed your risk tolerance threshold.",
      texttwo: "Remember, keeping your error counts below your risk thresholds greatly reduces the threat of a frivolous ADA non-compliance lawsuit being filed against you. Our in-house accessibility experts are on deck to fix these issues as soon as possible, or advise your internal development resources on what it will take to get back in bounds.",
      buttontext: "Get back on track",
      errora: (siteData.thresholda <= errorCounts[0] ? "⚠️" : ""),
      erroraa: (siteData.thresholdaa <= errorCounts[1] ? "⚠️" : "")
    }
  }

  let contacts = [];
  siteData.contacts[0].split(", ").map((x) => {
    contacts.push({
      email: x,
      type: "to"
    })
  })

  const run = async () => {
    const response = await mailchimp.messages.sendTemplate({
      template_name: "a11y-radar",
      template_content: [{}],
      message: {
        subject: "a11y.Radar: " + text.title,
        from_name: "a11y.Radar",
        from_email: "info@a11yradar.com",
        to: contacts,
        global_merge_vars: [
          {
            "name": "TITLE",
            "content": text.title
          },
          {
            "name": "TEXTONE",
            "content": text.textone
          },
          {
            "name": "TEXTTWO",
            "content": text.texttwo
          },
          {
            "name": "BUTTONTEXT",
            "content": text.buttontext
          },
          {
            "name": "LEVELA",
            "content": errorCounts[0]
          },
          {
            "name": "LEVELAA",
            "content": errorCounts[1]
          },
          {
            "name": "LEVELAAA",
            "content": errorCounts[2]
          },
          {
            "name": "ERRORA",
            "content": text.errora
          },
          {
            "name": "ERRORAA",
            "content": text.erroraa
          },
          {
            "name": "URL",
            "content": frontURL + siteData.slug
          }
        ],
      },
    });
    console.log(response);
  };

  run();
}

//interact with GQL

function doFetch (query, res, check, obj) {
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
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
              res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
              res.setHeader('Access-Control-Allow-Credentials', true);
              res.send(data)
            }
            if (check) {
              let siteData = data.data.addSortsiteScan.sortsiteScan[0].site;
              checkThresholds(siteData, [Object.keys(obj['a']).length, Object.keys(obj['aa']).length, Object.keys(obj['aaa']).length])
            }
           
        })
        .catch(error => {
            console.log(error)
        })
}

app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`)
})