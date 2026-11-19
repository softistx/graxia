import { createSchema } from '../schema/create-schema';
import { agentTypeDefs } from './directives';

/** A small library API that uses the three directives. */
export const library = createSchema()({
	typeDefs: [
		agentTypeDefs,
		`
"The library API."
type Query {
  "The books the caller may read."
  books(
    "Words the title contains."
    search: String @constraint(minLength: 2, maxLength: 80)
    "How many books to return."
    first: Int = 10 @constraint(min: 1, max: 100)
  ): [Book!]! @errors(codes: ["BAD_USER_INPUT"])
  "Every member of the library."
  members: [Member!]! @needs(permission: "members:read")
  "The caller's own notes."
  notes: [Note!]! @deprecated(reason: "Use books.")
  "The day a book is due, by pick."
  due(on: Day, pick: Pick): Day
  "Anything that matches the words."
  find(text: String!): [SearchHit!]! @needs(permission: "members:read")
}

"A mutation root."
type Mutation {
  "Adds a book to the shelf."
  addBook(input: BookInput!): Book! @needs(permission: "books:write") @errors(codes: ["BAD_USER_INPUT", "CONFLICT"])
}

"A book on a shelf."
type Book implements Node {
  "The book identifier."
  id: ID!
  "The title as printed on the cover."
  title: String!
  "The borrower, when lent out."
  borrower: Member
}

"A person registered with the library."
type Member implements Node @needs(permission: "members:read") {
  "The member identifier."
  id: ID!
  "The full name of the member."
  name: String!
}

"A private note."
type Note @needs(permission: "notes:read") {
  "The note text."
  text: String!
}

"Something with an identifier."
interface Node {
  "The identifier."
  id: ID!
}

"A book or a member."
union SearchHit = Book | Member

"A genre."
enum Genre {
  "Made up stories."
  FICTION
  "Real stories."
  HISTORY @deprecated(reason: "Use FICTION.")
}

"The fields of a new book."
input BookInput {
  "The title as printed on the cover."
  title: String! @constraint(minLength: 1, maxLength: 200, pattern: "^\\\\S")
  "The genre of the book."
  genre: Genre
}

"A day."
scalar Day @specifiedBy(url: "https://example.com/day")

"Pick one."
input Pick @oneOf {
  "By identifier."
  id: ID
  "By day."
  day: Day
}
`,
	],
	resolvers: {},
});
