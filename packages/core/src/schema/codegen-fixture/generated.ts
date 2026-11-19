import type {
	GraphQLResolveInfo,
	GraphQLScalarType,
	GraphQLScalarTypeConfig,
} from 'graphql';
import type { FixtureContext } from './context';
import type { UserRow } from './models';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & {
	[P in K]-?: NonNullable<T[P]>;
};
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
	ID: { input: string; output: string };
	String: { input: string; output: string };
	Boolean: { input: boolean; output: boolean };
	Int: { input: number; output: number };
	Float: { input: number; output: number };
	Date: { input: Date; output: Date };
};

export type Mutation = {
	__typename?: 'Mutation';
	addPost: Post;
};

export type MutationAddPostArgs = {
	input: PostInput;
};

export type Node = {
	id: Scalars['ID']['output'];
};

export type Post = Node & {
	__typename?: 'Post';
	author: User;
	id: Scalars['ID']['output'];
	title: Scalars['String']['output'];
};

export type PostInput = {
	title: Scalars['String']['input'];
};

export type Query = {
	__typename?: 'Query';
	me?: Maybe<User>;
	node?: Maybe<Node>;
	search: Array<SearchResult>;
	today: Scalars['Date']['output'];
};

export type QueryNodeArgs = {
	id: Scalars['ID']['input'];
};

export type QuerySearchArgs = {
	term: Scalars['String']['input'];
};

export enum Role {
	Admin = 'admin',
	Member = 'member',
}

export type SearchResult = Post | User;

export type Subscription = {
	__typename?: 'Subscription';
	clock: Scalars['Int']['output'];
	postAdded: Post;
};

export type User = Node & {
	__typename?: 'User';
	id: Scalars['ID']['output'];
	joined: Scalars['Date']['output'];
	name: Scalars['String']['output'];
	role: Role;
};

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
	resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<
	TResult,
	TParent = Record<PropertyKey, never>,
	TContext = Record<PropertyKey, never>,
	TArgs = Record<PropertyKey, never>,
> =
	| ResolverFn<TResult, TParent, TContext, TArgs>
	| ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
	parent: TParent,
	args: TArgs,
	context: TContext,
	info: GraphQLResolveInfo,
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
	parent: TParent,
	args: TArgs,
	context: TContext,
	info: GraphQLResolveInfo,
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
	parent: TParent,
	args: TArgs,
	context: TContext,
	info: GraphQLResolveInfo,
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<
	TResult,
	TKey extends string,
	TParent,
	TContext,
	TArgs,
> {
	subscribe: SubscriptionSubscribeFn<
		{ [key in TKey]: TResult },
		TParent,
		TContext,
		TArgs
	>;
	resolve?: SubscriptionResolveFn<
		TResult,
		{ [key in TKey]: TResult },
		TContext,
		TArgs
	>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
	subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
	resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<
	TResult,
	TKey extends string,
	TParent,
	TContext,
	TArgs,
> =
	| SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
	| SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<
	TResult,
	TKey extends string,
	TParent = Record<PropertyKey, never>,
	TContext = Record<PropertyKey, never>,
	TArgs = Record<PropertyKey, never>,
> =
	| ((
			...args: any[]
	  ) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
	| SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<
	TTypes,
	TParent = Record<PropertyKey, never>,
	TContext = Record<PropertyKey, never>,
> = (
	parent: TParent,
	context: TContext,
	info: GraphQLResolveInfo,
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<
	T = Record<PropertyKey, never>,
	TContext = Record<PropertyKey, never>,
> = (
	obj: T,
	context: TContext,
	info: GraphQLResolveInfo,
) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<
	TResult = Record<PropertyKey, never>,
	TParent = Record<PropertyKey, never>,
	TContext = Record<PropertyKey, never>,
	TArgs = Record<PropertyKey, never>,
> = (
	next: NextResolverFn<TResult>,
	parent: TParent,
	args: TArgs,
	context: TContext,
	info: GraphQLResolveInfo,
) => TResult | Promise<TResult>;

/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = {
	SearchResult: (Omit<Post, 'author'> & { author: _RefType['User'] }) | UserRow;
};

/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> =
	{
		Node: (Omit<Post, 'author'> & { author: _RefType['User'] }) | UserRow;
	};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
	Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
	Date: ResolverTypeWrapper<Scalars['Date']['output']>;
	ID: ResolverTypeWrapper<Scalars['ID']['output']>;
	Int: ResolverTypeWrapper<Scalars['Int']['output']>;
	Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
	Node: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Node']>;
	Post: ResolverTypeWrapper<
		Omit<Post, 'author'> & { author: ResolversTypes['User'] }
	>;
	PostInput: PostInput;
	Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
	Role: Role;
	SearchResult: ResolverTypeWrapper<
		ResolversUnionTypes<ResolversTypes>['SearchResult']
	>;
	String: ResolverTypeWrapper<Scalars['String']['output']>;
	Subscription: ResolverTypeWrapper<Record<PropertyKey, never>>;
	User: ResolverTypeWrapper<UserRow>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
	Boolean: Scalars['Boolean']['output'];
	Date: Scalars['Date']['output'];
	ID: Scalars['ID']['output'];
	Int: Scalars['Int']['output'];
	Mutation: Record<PropertyKey, never>;
	Node: ResolversInterfaceTypes<ResolversParentTypes>['Node'];
	Post: Omit<Post, 'author'> & { author: ResolversParentTypes['User'] };
	PostInput: PostInput;
	Query: Record<PropertyKey, never>;
	SearchResult: ResolversUnionTypes<ResolversParentTypes>['SearchResult'];
	String: Scalars['String']['output'];
	Subscription: Record<PropertyKey, never>;
	User: UserRow;
};

export interface DateScalarConfig
	extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
	name: 'Date';
}

export type MutationResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation'],
> = {
	addPost?: Resolver<
		ResolversTypes['Post'],
		ParentType,
		ContextType,
		RequireFields<MutationAddPostArgs, 'input'>
	>;
};

export type NodeResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['Node'] = ResolversParentTypes['Node'],
> = {
	__resolveType: TypeResolveFn<'Post' | 'User', ParentType, ContextType>;
};

export type PostResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['Post'] = ResolversParentTypes['Post'],
> = {
	author?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
	id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
	title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
	__isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type QueryResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['Query'] = ResolversParentTypes['Query'],
> = {
	me?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
	node?: Resolver<
		Maybe<ResolversTypes['Node']>,
		ParentType,
		ContextType,
		RequireFields<QueryNodeArgs, 'id'>
	>;
	search?: Resolver<
		Array<ResolversTypes['SearchResult']>,
		ParentType,
		ContextType,
		RequireFields<QuerySearchArgs, 'term'>
	>;
	today?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
};

export type RoleResolvers = { ADMIN: 'admin'; MEMBER: 'member' };

export type SearchResultResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['SearchResult'] = ResolversParentTypes['SearchResult'],
> = {
	__resolveType: TypeResolveFn<'Post' | 'User', ParentType, ContextType>;
};

export type SubscriptionResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription'],
> = {
	clock?: SubscriptionResolver<
		ResolversTypes['Int'],
		'clock',
		ParentType,
		ContextType
	>;
	postAdded?: SubscriptionResolver<
		ResolversTypes['Post'],
		'postAdded',
		ParentType,
		ContextType
	>;
};

export type UserResolvers<
	ContextType = FixtureContext,
	ParentType extends
		ResolversParentTypes['User'] = ResolversParentTypes['User'],
> = {
	id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
	joined?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
	name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
	role?: Resolver<ResolversTypes['Role'], ParentType, ContextType>;
	__isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type Resolvers<ContextType = FixtureContext> = {
	Date?: GraphQLScalarType;
	Mutation?: MutationResolvers<ContextType>;
	Node?: NodeResolvers<ContextType>;
	Post?: PostResolvers<ContextType>;
	Query?: QueryResolvers<ContextType>;
	Role?: RoleResolvers;
	SearchResult?: SearchResultResolvers<ContextType>;
	Subscription?: SubscriptionResolvers<ContextType>;
	User?: UserResolvers<ContextType>;
};
