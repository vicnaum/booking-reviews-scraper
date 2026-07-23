import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAirbnbDomainSwitchOrigin,
  extractPdpSectionsFromHtml,
  fetchListingPageData,
} from '../src/airbnb/listing.js';

function makePdpHtml(): string {
  return `
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
}

test('extractPdpSectionsFromHtml reads PDP sections from niobeClientData script blocks', () => {
  const html = makePdpHtml();
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

test('extractAirbnbDomainSwitchOrigin accepts localized Airbnb handoffs', () => {
  const html = `
    <html>
      <body>
        <form method="POST" action="https://www.airbnb.co.za/v2/domain_switch/handoff">
          <input type="hidden" name="version" value="1">
        </form>
      </body>
    </html>
  `;

  assert.equal(extractAirbnbDomainSwitchOrigin(html), 'https://www.airbnb.co.za');
});

test('extractAirbnbDomainSwitchOrigin rejects untrusted handoff targets', () => {
  const malicious = `
    <form method="POST" action="https://www.airbnb.co.za.evil.example/v2/domain_switch/handoff">
    </form>
  `;
  const insecure = `
    <form method="POST" action="http://www.airbnb.co.uk/v2/domain_switch/handoff">
    </form>
  `;

  assert.equal(extractAirbnbDomainSwitchOrigin(malicious), null);
  assert.equal(extractAirbnbDomainSwitchOrigin(insecure), null);
});

test('fetchListingPageData follows a localized Airbnb domain handoff', async () => {
  const requestedUrls: string[] = [];
  const handoffHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Redirecting to www.airbnb.co.uk</title></head>
      <body>
        <form method="POST" action="https://www.airbnb.co.uk/v2/domain_switch/handoff">
        </form>
      </body>
    </html>
  `;

  const result = await fetchListingPageData(
    '47045396',
    {
      checkIn: '2026-07-29',
      checkOut: '2026-08-11',
      adults: 2,
    },
    async (url) => {
      requestedUrls.push(url);
      return {
        data: requestedUrls.length === 1 ? handoffHtml : makePdpHtml(),
        status: 200,
        statusText: 'OK',
      };
    },
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]).hostname, 'www.airbnb.com');
  assert.equal(new URL(requestedUrls[1]).hostname, 'www.airbnb.co.uk');
  assert.equal(new URL(requestedUrls[1]).searchParams.get('check_in'), '2026-07-29');
  assert.equal(new URL(requestedUrls[1]).searchParams.get('check_out'), '2026-08-11');
  assert.equal(new URL(requestedUrls[1]).searchParams.get('adults'), '2');
  assert.equal(result.sections.length, 2);
  assert.equal(result.metadata.pageTitle, 'Test Airbnb Listing page');
});

test('fetchListingPageData stops a domain handoff loop', async () => {
  const requestedHosts: string[] = [];

  await assert.rejects(
    fetchListingPageData('47045396', undefined, async (url) => {
      const requestedHost = new URL(url).hostname;
      requestedHosts.push(requestedHost);
      const targetHost = requestedHost === 'www.airbnb.com' ? 'www.airbnb.co.uk' : 'www.airbnb.com';

      return {
        data: `
          <form
            method="POST"
            action="https://${targetHost}/v2/domain_switch/handoff"
          ></form>
        `,
        status: 200,
        statusText: 'OK',
      };
    }),
    /Could not extract PDP sections/,
  );

  assert.deepEqual(requestedHosts, ['www.airbnb.com', 'www.airbnb.co.uk']);
});
