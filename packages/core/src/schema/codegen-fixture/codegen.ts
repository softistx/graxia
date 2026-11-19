import type { CodegenConfig } from '@graphql-codegen/cli';

/** Regenerates `generated.ts`: `bun run codegen:fixture`. Never run by build or test. */
const config: CodegenConfig = {
	schema: 'src/schema/codegen-fixture/schema.graphql',
	generates: {
		'src/schema/codegen-fixture/generated.ts': {
			plugins: ['typescript', 'typescript-resolvers'],
			config: {
				contextType: './context#FixtureContext',
				useTypeImports: true,
				// the database row, not the GraphQL type, is what resolvers return
				mappers: { User: './models#UserRow' },
				// the enum's internal values
				enumValues: { Role: { ADMIN: 'admin', MEMBER: 'member' } },
				scalars: { Date: 'Date' },
			},
		},
	},
};

export default config;
