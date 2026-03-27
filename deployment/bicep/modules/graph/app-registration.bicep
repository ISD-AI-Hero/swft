extension microsoftGraphV1

param customer string
param product string
@allowed(['API', 'UI'])
param purpose string
param env string
param displayName string = 'app-${customer}-${product}-${purpose}-${env}'
param spaSettings MicrosoftGraphSpaApplication?

@allowed(['AzureADMyOrg', 'AzureADMultipleOrgs', 'AzureADandPersonalMicrosoftAccount', 'PersonalMicrosoftAccount'])
param signInAudience string = 'AzureADMyOrg'
param api MicrosoftGraphApiApplication?
param keyCredentials array = []
param appRoles MicrosoftGraphAppRole[] = []
param webApplication MicrosoftGraphWebApplication?
param defaultRedirectUri string = ''
param description string
@sys.description('Configures the groups claim issued in a user or OAuth 2.0 access token that the application expects. To set this attribute, use one of the following valid string values: None, SecurityGroup (for security groups and Microsoft Entra roles), All (this gets all of the security groups, distribution groups, and Microsoft Entra directory roles that the signed-in user is a member of).')
@allowed(['None', 'SecurityGroup', 'All'])
param groupMembershipClaims string?
@sys.description('Also known as App ID URI, this value is set when an application is used as a resource app. The identifierUris acts as the prefix for the scopes you reference in your API\'s code, and it must be globally unique. You can use the default value provided, which is in the form api://<appId>, or specify a more readable URI like https://contoso.com/api. For more information on valid identifierUris patterns and best practices, see Microsoft Entra application registration security best practices. Not nullable')
param identifierUris string[] = type == 'API' ? [ 'api://${toLower('app-${customer}-${product}-${purpose}-${env}')}' ] : []
@sys.description('Basic profile information of the application such as  app\'s marketing, support, terms of service and privacy statement URLs. The terms of service and privacy statement are surfaced to users through the user consent experience. For more info, see How to: Add Terms of service and privacy statement for registered Microsoft Entra apps')
param informationUrl MicrosoftGraphInformationalUrl?
@sys.description('Specifies whether this application supports device authentication without a user. The default is false.')
param isDeviceOnlyAuthSupported bool = false
@sys.description('Specifies the fallback application type as public client, such as an installed application running on a mobile device. The default value is false, which means the fallback application type is confidential client such as a web app. There are certain scenarios where Microsoft Entra ID can\'t determine the client application type. For example, the ROPC flow where it\'s configured without specifying a redirect URI. In those cases, Microsoft Entra ID interprets the application type based on the value of this property.')
param isFallbackPublicClient bool = false
@sys.description('Specifies whether the Native Authentication APIs are enabled for the application. The possible values are: none and all. Default is none. For more information, see Native Authentication.')
@allowed(['none', 'all'])
param nativeAuthenticationApisEnabled string = 'none'
@sys.description('Notes relevant for the management of the application.')
param notes string?
@sys.description('Application developers can configure optional claims in their Microsoft Entra applications to specify the claims that are sent to their application by the Microsoft security token service. For more information, see How to: Provide optional claims to your app.')
param optionalClaims MicrosoftGraphOptionalClaims?
@sys.description('Specifies parental control settings for an application.')
param parentalControlSettings MicrosoftGraphParentalControlSettings?
@sys.description('The collection of password credentials associated with the application. Not nullable.')
param passwordCredentials MicrosoftGraphPasswordCredential[] = []
@sys.description('Specifies settings for installed clients such as desktop or mobile devices.')
param publicClient MicrosoftGraphPublicClientApplication?
@sys.description('Specifies whether this application requires Microsoft Entra ID to verify the signed authentication requests.')
param requestSignatureVerification MicrosoftGraphRequestSignatureVerification?
@sys.description('Specifies the resources that the application needs to access. This property also specifies the set of delegated permissions and application roles that it needs for each of those resources. This configuration of access to the required resources drives the consent experience. No more than 50 resource services (APIs) can be configured. Beginning mid-October 2021, the total number of required permissions must not exceed 400. For more information, see Limits on requested permissions per app. Not nullable')
param requiredResourceAccess MicrosoftGraphRequiredResourceAccess[] = []
@sys.description('The URL where the service exposes SAML metadata for federation. This property is valid only for single-tenant applications. Nullable.')
param samlMetadataUrl string?
@sys.description('References application or service contact information from a Service or Asset Management database. Nullable.')
param serviceManagementReference string?
@sys.description('Specifies whether sensitive properties of a multitenant application should be locked for editing after the application is provisioned in a tenant. Nullable. null by default.')
param servicePrincipalLockConfiguration MicrosoftGraphServicePrincipalLockConfiguration?
@sys.description('Custom strings that can be used to categorize and identify the application. Not nullable')
param tags string[] = []

@allowed(['SPA', 'Web', 'API', 'PublicClient'])
param type string
@sys.description('Specifies the keyId of a public key from the keyCredentials collection. When configured, Microsoft Entra ID encrypts all the tokens it emits by using the key this property points to. The application code that receives the encrypted token must use the matching private key to decrypt the token before it can be used for the signed-in user.')
param tokenEncryptionKeyId string?
@sys.description('Specifies the verified publisher of the application. For more information about how publisher verification helps support application security, trustworthiness, and compliance, see Publisher verification.')
param verifiedPublisher MicrosoftGraphVerifiedPublisher?

var applicationNameFinal = toLower('app-${customer}-${product}-${purpose}-${env}')

resource application 'Microsoft.Graph/applications@v1.0' = {
  api: type == 'API' ? api : null
  displayName: displayName
  uniqueName: guid(tenant().tenantId, customer, product, purpose, env)
  signInAudience: signInAudience
  appRoles: appRoles
  defaultRedirectUri: defaultRedirectUri
  description: description
  groupMembershipClaims: groupMembershipClaims
  identifierUris: identifierUris
  info: informationUrl
  isDeviceOnlyAuthSupported: isDeviceOnlyAuthSupported
  isFallbackPublicClient: isFallbackPublicClient
  keyCredentials: keyCredentials
  nativeAuthenticationApisEnabled: nativeAuthenticationApisEnabled
  notes: notes
  optionalClaims: optionalClaims
  parentalControlSettings: parentalControlSettings
  passwordCredentials: passwordCredentials
  publicClient: type == 'PublicClient' ? publicClient : null
  requestSignatureVerification: requestSignatureVerification
  requiredResourceAccess: requiredResourceAccess
  samlMetadataUrl: samlMetadataUrl
  serviceManagementReference: serviceManagementReference
  servicePrincipalLockConfiguration: servicePrincipalLockConfiguration
  spa: type == 'SPA' ? spaSettings : null
  tags: tags
  tokenEncryptionKeyId: tokenEncryptionKeyId
  verifiedPublisher: verifiedPublisher ?? {}
  web: type == 'Web' ? webApplication : null
}

resource servicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: application.appId
}

type MicrosoftGraphApiApplication = {
  acceptMappedClaims: bool?
  knownClientApplications: string?
  oauth2PermissionScopes: MicrosoftGraphPermissionScope[]
  preAuthorizedApplications: MicrosoftGraphPreAuthorizedApplication[]
  requestedAccessTokenVersion: 1 | 2 | null
}

type MicrosoftGraphPermissionScope = {
  adminConsentDescription: string
  adminConsentDisplayName: string
  id: string
  isEnabled: bool
  type: 'User' | 'Admin'
  userConsentDescription: string
  userConsentDisplayName: string
  value: string
}

type MicrosoftGraphPreAuthorizedApplication = {
  appId: string
  @sys.description('The unique identifier for the oauth2PermissionScopes the application requires.')
  delegatedPermissionIds: string[]
}

type MicrosoftGraphAppRole = {
  allowedMemberTypes: ['User'] | ['Application'] | ['User', 'Application']
  description: string
  displayName: string
  id: string
  isEnabled: bool
  value: string
}

type MicrosoftGraphSpaApplication = {
  redirectUris: string[]
}

type MicrosoftGraphWebApplication = {
  homePageUrl: string?
  implicitGrantSettings: MicrosoftGraphImplicitGrantSettings
  logoutUrl: string?
  redirectUris: string[]
  redirectUriSettings: MicrosoftGraphRedirectUriSettings[]?
}

type MicrosoftGraphImplicitGrantSettings = {
  enableAccessTokenIssuance: bool
  enableIdTokenIssuance: bool
}

type MicrosoftGraphRedirectUriSettings = {
  index: int
  uri: string
}

type MicrosoftGraphOptionalClaims = {
  accessToken: MicrosoftGraphOptionalClaim[]
  idToken: MicrosoftGraphOptionalClaim[]
  saml2Token: MicrosoftGraphOptionalClaim[]
}

type MicrosoftGraphOptionalClaim = {
  additionalProperties: string[]
  essential: bool
  name: string
  source: string
}

type MicrosoftGraphParentalControlSettings = {
  countriesBlockedForMinors: string[]
  legalAgeGroupRule: 'Allow' | 'RequireConsentForPrivacyServices' | 'RequireConsentForMinors' | 'RequireConsentForKids' | 'BlockMinors'
}

type MicrosoftGraphPasswordCredential = {
  displayName: string
  endDateTime: string
  keyId: string
  startDateTime: string
}

type MicrosoftGraphPublicClientApplication = {
  redirectUris: string[]
}

type MicrosoftGraphRequestSignatureVerification = {
  allowedWeakAlgorithms: 'rsaSha1' | 'unknownFutureValue'
  isSignedRequestRequired: bool
}

type MicrosoftGraphRequiredResourceAccess = {
  resourceAccess: MicrosoftGraphResourceAccess[]
  resourceAppId: string
}

type MicrosoftGraphResourceAccess = {
  id: string
  type: 'Scope' | 'Role'
}

type MicrosoftGraphServicePrincipalLockConfiguration = {
  allProperties: bool
  credentialsWithUsageSign: bool
  credentialsWithUsageVerify: bool
  isEnabled: bool
  tokenEncryptionKeyId: bool
}

type MicrosoftGraphVerifiedPublisher = {
  addedDateTime: string
  displayName: string
  verifiedPublisherId: string
}

type MicrosoftGraphInformationalUrl = {
  marketingUrl: string
  privacyStatementUrl: string
  supportUrl: string
  termsOfServiceUrl: string
}

output appId string = application.appId
output uniqueName string = application.uniqueName
