/**
 * The exact BC legislative sources the live tools on knowyourstrata.com
 * actually depend on -- not the whole of bclaws.gov.bc.ca, just these.
 *
 * When a new BC tool cites a bclaws URL not already in this list, add it
 * here. `id` is used as the KV key prefix, so once a source has run at
 * least once, don't change its id -- that would orphan its history and
 * make the watcher treat it as brand new.
 */
export const SOURCES = [
  {
    id: 'act-part1',
    label: 'Strata Property Act — Part 1 (definitions & interpretation)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_01'
  },
  {
    id: 'act-part4',
    label: 'Strata Property Act — Part 4 (meetings, records, conflict of interest)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_04'
  },
  {
    id: 'act-part6',
    label: 'Strata Property Act — Part 6 (fees, levies, contingency reserve fund)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_06'
  },
  {
    id: 'act-part7',
    label: 'Strata Property Act — Part 7 (bylaw enforcement & fines)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_07'
  },
  {
    id: 'act-part9',
    label: 'Strata Property Act — Part 9 (insurance)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_09'
  },
  {
    id: 'regulation',
    label: 'Strata Property Regulation (CRF floor, retention periods, fine ceilings)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/43_2000'
  },
  {
    id: 'standard-bylaws',
    label: 'Schedule of Standard Bylaws (council quorum, tie votes, minutes distribution)',
    url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_18'
  }
];
