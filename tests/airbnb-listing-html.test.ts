import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdpSectionsFromHtml } from '../src/airbnb/listing.js';

test('extractPdpSectionsFromHtml reads PDP sections from niobeClientData script blocks', () => {
  const html = `
    <html>
      <body>
        <script type="application/json">
          ${JSON.stringify({
            niobeClientData: [
              [
                'StaysPdpSections:{"id":"U3RheUxpc3Rpbmc6MTIz"}',
                {
                  data: {
                    presentation: {
                      stayProductDetailPage: {
                        sections: {
                          sections: [
                            {
                              sectionId: 'TITLE_DEFAULT',
                              section: {
                                title: 'Test Airbnb Listing',
                              },
                            },
                            {
                              sectionId: 'AMENITIES_DEFAULT',
                              section: {
                                seeAllAmenitiesGroups: [],
                              },
                            },
                          ],
                          metadata: {
                            pageTitle: 'Test Airbnb Listing page',
                            sharingConfig: {
                              title: 'Rental unit · 1 bedroom · 1 bed · 1 bath',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            ],
          })}
        </script>
      </body>
    </html>
  `;

  const extracted = extractPdpSectionsFromHtml(html);
  assert.ok(extracted);
  assert.equal(extracted.sections.length, 2);
  assert.equal(extracted.sections[0].sectionId, 'TITLE_DEFAULT');
  assert.equal(extracted.metadata.pageTitle, 'Test Airbnb Listing page');
});

test('extractPdpSectionsFromHtml returns null when niobe PDP data is absent', () => {
  const html = '<html><body><script type="application/json">{"hello":"world"}</script></body></html>';
  assert.equal(extractPdpSectionsFromHtml(html), null);
});
