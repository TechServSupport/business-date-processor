const express = require('express');
const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

const FRESHDESK_DOMAIN = 'helptechserv';
const API_KEY = 'bF1l8GuBYr8viKyCH4T';

app.use(bodyParser.json());

async function getAttachmentUrls(ticketId) {
    const url = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets/${ticketId}`;
    const response = await axios.get(url, {
      auth: {
        username: API_KEY,
        password: 'X',
      },
    });
    
    if (response.status === 200 && response.data.attachments.length > 0) {
      const attachmentUrls = response.data.attachments.map(attachment => attachment.attachment_url);
      return attachmentUrls;
    }
    return [];
  }

async function downloadCsv(url) {
  const response = await axios.get(url, { responseType: 'stream' });
  if (response.status === 200) {
    const filePath = path.join(__dirname, 'attachment.csv');
    response.data.pipe(fs.createWriteStream(filePath));
    return new Promise((resolve) => {
      response.data.on('end', () => resolve(filePath));
    });
  }
  return null;
}

async function processCsv(filePath) {
    const currentDate = new Date().toLocaleDateString('en-US');
    const outOfSyncStores = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          if (!row.Name.includes("Sonny's BBQ 9999") && !row.Name.includes("LAB")) {
            // Skip rows that don't contain "Sonny's BBQ 9999" or "LAB" in the Name column
            return;
          }
          if (row.BusinessDate !== currentDate) {
            outOfSyncStores.push(row.Name);
          }
        })
        .on('end', () => {
          // Delete the CSV file after processing
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting CSV file: ${err}`);
            } else {
              console.log(`CSV file deleted: ${filePath}`);
            }
          });
          resolve(outOfSyncStores);
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

async function postOutOfSyncStores(ticketId, stores) {
  const url = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets/${ticketId}/notes`;
  const response = await axios.post(
    url,
    {
      body: `[Automatically Generated via Webhook]: The following stores have out-of-sync business dates:
      <br>
      </br>${stores.join('</br>')}`,
      private: true,
    },
    {
      auth: {
        username: API_KEY,
        password: 'X',
      },
    }
  );

  return response.status === 201;
}

app.post('/webhook', async (req, res) => {
    const ticketId = req.body.ticket_id;
    try {
      console.log(`Received webhook for ticket ${ticketId}`);
      const attachmentUrls = await getAttachmentUrls(ticketId);
      if (attachmentUrls.length > 0) {
        for (const attachmentUrl of attachmentUrls) {
          const csvFile = await downloadCsv(attachmentUrl);
          if (csvFile) {
            const outOfSyncStores = await processCsv(csvFile);
            if (outOfSyncStores.length > 0) {
              const success = await postOutOfSyncStores(ticketId, outOfSyncStores);
              if (!success) {
                return res.status(500).send('Failed to post out-of-sync stores.');
              }
            } else {
              return res.status(200).send('All stores are in sync.');
            }
          } else {
            return res.status(500).send('Failed to download CSV file.');
          }
        }
        res.status(200).send('All attachments processed successfully.');
      } else {
        res.status(404).send('No attachments found for the ticket.');
      }
    } catch (error) {
      res.status(500).send(`An error occurred: ${error.message}`);
    }
  });

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
