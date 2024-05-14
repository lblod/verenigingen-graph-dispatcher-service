/**
 * @module parse-binding-utils
 * @description This module provides some utility functions used throughout the
 * rest of the tools library or externally.
 */

import * as N3 from 'n3';
const { namedNode, literal, blankNode, quad } = N3.DataFactory;

// The following code is made possible thanks to @rubensworks.
// This code has been transcribed from the following to fit our needs:
// https://github.com/rubensworks/sparqljson-parse.js/blob/master/lib/SparqlJsonParser.ts

/**
 * Parse a SPARQL JSON term to the appropriate RDFJS term.
 *
 * @public
 * @function
 * @param {object} jsonTerm - The contents of a binding from SPARQL JSON
 * results. This is usually of the structure: `{ type: 'bnode|literal|uri',
 * value: 'some value' }` but also deals with Virtuoso's 'typed-literal' key.
 * @returns {namedNode|blankNode|literal} A single RDFJS term.
 */
export function parseSparqlJsonTerm(jsonTerm) {
  let parsedTerm;
  switch (jsonTerm.type) {
    case 'bnode':
      parsedTerm = blankNode(jsonTerm.value);
      break;
    case 'literal':
      if (jsonTerm['xml:lang']) {
        parsedTerm = literal(jsonTerm.value, jsonTerm['xml:lang']);
      } else if (jsonTerm.datatype) {
        parsedTerm = literal(jsonTerm.value, namedNode(jsonTerm.datatype));
      } else {
        parsedTerm = literal(jsonTerm.value);
      }
      break;
    case 'typed-literal':
      // Virtuoso uses this non-spec-compliant way of defining typed literals
      parsedTerm = literal(jsonTerm.value, namedNode(jsonTerm.datatype));
      break;
    default:
      parsedTerm = namedNode(jsonTerm.value);
      break;
  }
  return parsedTerm;
}

/**
 * Parse a full SPARQL JSON results binding to RDFJS specification.
 *
 * @public
 * @function
 * @param {object} rawBinding - This is an object from the array of bindings
 * from the SPARQL JSON results. E.g. this could be of the structure `{ book:
 * term, isbn: term, pages: term }` where every `term` is an object as
 * described in {@link parseSparqlJsonTerm}.
 * @results {object} This is an object with the same keys as the input object,
 * but where every value is parsed to the appropriate RDFJS term. E.g. as a
 * continuation of the previous example: `{ book: namedNode, isbn: literal,
 * pages: literal }`.
 */
export function parseSparqlJsonBinding(rawBinding) {
  let parsedBinding = {};
  for (const key in rawBinding)
    parsedBinding[key] = parseSparqlJsonTerm(rawBinding[key]);
  return parsedBinding;
}

/**
 * Parse a full SPARQL JSON results binding to RDFJS quad specification. This
 * only works when the variables in the SPARQL query are 'subject', 'predicate'
 * and 'object'. Think of this function as a shorthand for using {@link
 * parseSparqlJsonBinding} and an extra map over the bindings to translate them
 * into triples when dealing with results from CONSTRUCT queries or
 * mu-authorization/delta-notifier results.
 *
 * @public
 * @function
 * @param {object} rawBinding - This is an object from the array of bindings
 * from the SPARQL JSON results. E.g. this could be of the structure `{ s:
 * term, p: term, o: term }` where every `term` is an object as described in
 * {@link parseSparqlJsonTerm}.
 * @results {quad} This is an RDFJS quad representing the triple for the given
 * binding.
 */
export function parseSparqlJsonBindingQuad(rawBinding) {
  return quad(
    parseSparqlJsonTerm(rawBinding.subject || rawBinding.s),
    parseSparqlJsonTerm(rawBinding.predicate || rawBinding.p),
    parseSparqlJsonTerm(rawBinding.object || rawBinding.o),
    parseSparqlJsonTerm(rawBinding.graph || rawBinding.g),
  );
}
