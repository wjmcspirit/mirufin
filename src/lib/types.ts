export interface UserData {
  PlaybackPositionTicks?: number
  PlayedPercentage?: number
  Played?: boolean
  IsFavorite?: boolean
  UnplayedItemCount?: number
  PlayCount?: number
  LastPlayedDate?: string
}

export interface MediaStream {
  Index?: number
  Type?: "Video" | "Audio" | "Subtitle" | string
  Codec?: string
  Language?: string
  DisplayTitle?: string
  Title?: string
  IsDefault?: boolean
  IsForced?: boolean
  IsExternal?: boolean
  IsHearingImpaired?: boolean
  BitDepth?: number
  BitRate?: number
  VideoRange?: string
  VideoRangeType?: string
  VideoDoViTitle?: string
  Profile?: string
  Level?: number
  AverageFrameRate?: number
  Width?: number
  Height?: number
  IsInterlaced?: boolean
  ColorSpace?: string
  ColorTransfer?: string
  ColorPrimaries?: string
  PixelFormat?: string
  Channels?: number
  ChannelLayout?: string
  SampleRate?: number
  DeliveryMethod?: string
  DeliveryUrl?: string
  IsTextSubtitleStream?: boolean
}

export interface MediaSource {
  Id: string
  Container?: string
  Size?: number
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
  TranscodingUrl?: string | null
  DirectStreamUrl?: string | null
  Bitrate?: number
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
  MediaStreams?: MediaStream[]
  RunTimeTicks?: number
}

export interface Chapter {
  Name?: string
  StartPositionTicks?: number
}

export interface Person {
  Id?: string
  Name?: string
  Role?: string
  Type?: string
  PrimaryImageTag?: string
}

export interface TrickplayInfo {
  Width: number
  Height: number
  TileWidth: number
  TileHeight: number
  ThumbnailCount: number
  Interval: number
  Bandwidth?: number
}

export interface MediaSegment {
  Id?: string
  ItemId?: string
  Type?: string
  StartTicks?: number
  EndTicks?: number
}

export type SegmentType = "Intro" | "Outro" | "Recap" | "Preview" | "Commercial"
export type SkipMode = "ask" | "auto" | "off"

export interface Item {
  Id: string
  Name?: string
  Type?: string
  MediaType?: string
  Overview?: string
  ProductionYear?: number
  PremiereDate?: string
  DateCreated?: string
  DateLastMediaAdded?: string
  EndDate?: string
  RunTimeTicks?: number
  CommunityRating?: number
  CriticRating?: number
  OfficialRating?: string
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  ParentLogoItemId?: string
  ParentLogoImageTag?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  Trickplay?: Record<string, Record<string, TrickplayInfo>>
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  ParentId?: string
  SeasonName?: string
  IndexNumber?: number
  ParentIndexNumber?: number
  ChildCount?: number
  RecursiveItemCount?: number
  CollectionType?: string
  UserData?: UserData
  Status?: string
  ExtraType?: string
  Genres?: string[]
  GenreItems?: { Id?: string; Name?: string }[]
  People?: Person[]
  Studios?: { Id?: string; Name?: string }[]
  Taglines?: string[]
  RemoteTrailers?: { Name?: string; Url?: string }[]
  LocalTrailerCount?: number
  MediaSources?: MediaSource[]
  MediaStreams?: MediaStream[]
  Chapters?: Chapter[]
  SeriesPrimaryImageTag?: string
  AlbumId?: string
  Album?: string
  AlbumPrimaryImageTag?: string
  Artists?: string[]
  HasPassword?: boolean
  PrimaryImageTag?: string
}

export interface ItemList {
  Items: Item[]
  TotalRecordCount?: number
}

export interface PublicUser {
  Id: string
  Name: string
  HasPassword: boolean
  PrimaryImageTag?: string
}

export interface AuthResult {
  AccessToken: string
  User: { Id: string; Name: string }
  ServerId?: string
}

export interface PublicInfo {
  ServerName?: string
  Version?: string
  Id?: string
  LocalAddress?: string
}

export interface PlaybackInfo {
  PlaySessionId?: string
  MediaSources?: MediaSource[]
}

export type HomeCardStyle = "poster" | "landscape"
export type HomeCardSize = "small" | "medium" | "large"

export interface HomeRowSetting {
  id: string
  visible: boolean
  style: HomeCardStyle
  size: HomeCardSize
}

export interface Preferences {
  showTitles: boolean
  preferLogos: boolean
  showClock: boolean
  themeMusic: boolean
  autoplayNext: boolean
  nextUp: "end" | "credits" | "never"
  nextUpDelay: number
  resumeRewind: number
  skipBack: number
  skipForward: number
  cinemaMode: boolean
  screensaverMinutes: number
  maxBitrate: number
  skip: Record<SegmentType, SkipMode>
  subtitleSize: "small" | "medium" | "large"
  subtitleRaise: number
  showHero: boolean
  homeRows: HomeRowSetting[]
  libraryStyle: HomeCardStyle
  librarySize: HomeCardSize
}
