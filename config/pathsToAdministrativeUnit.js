import { NAMESPACES as ns } from '../env';

/*
 * This file is used to construct queries to get the association a
 * piece of data is related to. The prefixes used can be found in the `env.js`
 * file.
 *
 * NOTE: make sure to use the full URI (no prefixes) for the `type` property.
 */

export default [
  // VERENIGING
  {
    type: ns.vereniging`FeitelijkeVereniging`,
    pathToAssociation: `
    ?subject a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> .
    `,
    allowedInMultipleOrgs: false,
  },
  // VERTEGENWOORDIGER
  {
    type: ns.person`Person`,
    pathToAssociation: `
    ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
    <https://data.lblod.info/ns/vertegenwoordigers> ?subject .
    `,
    allowedInMultipleOrgs: true,
  },
  // PRIMARY SITE
  {
    type: ns.org`Site`,
    pathToAssociation: `
    ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
    <http://www.w3.org/ns/org#hasPrimarySite> ?subject .

    `,
    allowedInMultipleOrgs: true,
  },
    // SITES
    {
      type: ns.org`Site`,
      pathToAssociation: `
      ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
      <http://www.w3.org/ns/org#hasSite> ?subject .
      `,
      allowedInMultipleOrgs: true,
    },
    // AUDIENCE
    {
      type: ns.verenigingen_ext`Doelgroep`,
      pathToAssociation: `
      ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
      <http://data.lblod.info/vocabularies/FeitelijkeVerenigingen/doelgroep> ?subject .
      `,
      allowedInMultipleOrgs: true,
    },
    // ACTIVITY
    {
      type: ns.skos`Concept`,
      pathToAssociation: `
      ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
      <http://www.w3.org/ns/regorg#orgActivity> ?subject .
      `,
      allowedInMultipleOrgs: true,
    },
    // TYPE
    {
      type: ns.code`TypeVestiging`,
      pathToAssociation: `
      ?site a <http://www.w3.org/ns/org#Site> ;
      <http://data.lblod.info/vocabularies/erediensten/vestigingstype> ?subject .
      ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> .
      ?association ?p ?site .
      `,
      allowedInMultipleOrgs: true,
    },
    // ADDRESS
    {
      type: ns.locn`Address`,
      pathToAssociation: `
      ?site a <http://www.w3.org/ns/org#Site> ;
      <https://data.vlaanderen.be/ns/organisatie#bestaatUit> ?subject .
      ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> .
      ?association ?p ?site .
      `,
      allowedInMultipleOrgs: true,
  },
  // CONTACTPOINT
  {
    type: ns.schema`ContactPoint`,
    pathToAssociation: `
    ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
     <http://schema.org/contactPoint> ?subject .
    `,
    allowedInMultipleOrgs: true,
},
  // MEMBER CONTACTPOINT
  {
    type: ns.schema`ContactPoint`,
    pathToAssociation: `
    ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
    org:hasMembership ?membership .

    ?membership a org:Membership;
      mu:uuid ?membershipUuid;
      org:member ?person.

    ?person schema:contactPoint ?subject .
    `,
    allowedInMultipleOrgs: true,
},
 // SITE ADDRESS (CONTACT)
{
  type: ns.schema`ContactPoint`,
  pathToAssociation: `
  ?site a <http://www.w3.org/ns/org#Site> ;
  <http://schema.org/siteAddress> ?subject .
  ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> .
  ?association ?p ?site .
  `,
  allowedInMultipleOrgs: true,
},
 // IDENTIFIER
 {
  type: ns.adms`Identifier`,
  pathToAssociation: `
  ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
  <http://www.w3.org/ns/adms#identifier> ?subject .
  `,
  allowedInMultipleOrgs: true,
},
 // STRUCTURED IDENTIFICATOR
 {
  type: ns.generiek`GestructureerdeIdentificator`,
  pathToAssociation: `
  ?subject a <https://data.vlaanderen.be/ns/generiek#GestructureerdeIdentificator> .
  ?identifier a <http://www.w3.org/ns/adms#Identifier> ;
              <https://data.vlaanderen.be/ns/generiek#gestructureerdeIdentificator> ?subject .
  ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
  <http://www.w3.org/ns/adms#identifier> ?identifier .
  `,
  allowedInMultipleOrgs: true,
},
//REPRESENTATIVES
{
  type: ns.org`Membership`,
  pathToAssociation: `
  ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
  <http://www.w3.org/ns/org#hasMembership> ?subject .
  `,
  allowedInMultipleOrgs: true,
},
//PERSONS
{
  type: ns.person`Person`,
  pathToAssociation: `
  ?association a <https://data.vlaanderen.be/ns/FeitelijkeVerenigingen#FeitelijkeVereniging> ;
    <http://www.w3.org/ns/org#hasMembership> ?membership .
  ?membership org:member ?subject .
  `,
  allowedInMultipleOrgs: true,
},
//PERSON CONTACT
{
  type: ns.person`Person`,
  pathToAssociation: `
  ?subject a <http://schema.org/ContactPoint>.

  ?site a <http://www.w3.org/ns/org#Site>;
  <http://www.w3.org/ns/org#siteAddress> ?subject .

  ?person a <http://www.w3.org/ns/person#Person>;
  <http://www.w3.org/ns/org#basedAt> ?site .

  ?member a <http://www.w3.org/ns/org#Membership> ;
            <http://www.w3.org/ns/org#member> ?person ;
            <http://www.w3.org/ns/org#organization> ?association .
  `,
  allowedInMultipleOrgs: true,
}
];


