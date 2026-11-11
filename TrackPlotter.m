function TrackPlotter()
% TrackPlotter  — interactive analysis viewer for AnimalTracker export CSVs
%
%   Workflow:
%     1. Select a folder of *_tracks.csv files.
%     2. Click through files; adjust FPS / scale / min-speed / polaroid angle /
%        video frame size.  Settings are saved per file.  ✓ = configured.
%     3. Click "Batch Save All" to export a PDF for every file.
%        Output goes to <folder>/TrackPlotter_Figures/.
%
%   CSV format (AnimalTracker export):
%     Frame, {Label}_X, {Label}_Y   [one X/Y pair per animal]

    %% ── State ────────────────────────────────────────────────────────────────
    try
        saved = getpref('TrackPlotter','lastFolder');
        if ischar(saved) && isfolder(saved), S.folder = saved; else, S.folder = ''; end
    catch
        S.folder = '';
    end
    S.files          = {};
    S.fileSettings   = {};
    S.data           = [];
    S.animalNames    = {};
    S.globalSpeedMax = 0;
    S.globalHistMaxSpd = 0;
    S.globalHistMaxDir = 0;
    S.speedPrctile   = 95;
    % containers.Map is a handle object: writes to it are visible through
    % every copy of S without needing a setappdata round-trip, so it's used
    % to cache readtable() results across the many folder-wide scans/exports
    % that would otherwise each re-read every CSV from disk.
    S.tableCache     = containers.Map('KeyType','char','ValueType','any');

    %% ── Main figure ─────────────────────────────────────────────────────────
    fig = figure('Name','Track Plotter','NumberTitle','off','Color','w', ...
        'Units','pixels','Position',[50 60 1420 900], ...
        'MenuBar','none','ToolBar','none','Resize','on');
    % Set SizeChangedFcn only after fig is assigned — passing it as a
    % constructor argument lets the callback fire (figure realization can
    % trigger a size-changed event immediately) before this function's own
    % `fig` variable is bound, which throws "Unrecognized variable 'fig'".
    fig.SizeChangedFcn = @onFigureResize;

    %% ── Left control panel ──────────────────────────────────────────────────
    LP = uipanel(fig,'Units','pixels','Position',[5 5 268 890],...
        'BackgroundColor',[0.94 0.94 0.96],'BorderType','line', ...
        'HighlightColor',[0.75 0.75 0.82],'Title','');
    PH = 870;
    lpy = @(f) round(f * PH);

    uicontrol(LP,'Style','text','String','TRACK PLOTTER', ...
        'Units','pixels','Position',[10 855 218 26], ...
        'FontSize',12,'FontWeight','bold', ...
        'BackgroundColor',[0.94 0.94 0.96],'ForegroundColor',[0.15 0.25 0.50], ...
        'HorizontalAlignment','center');
    uicontrol(LP,'Style','pushbutton','String','?', ...
        'Units','pixels','Position',[232 855 26 26], ...
        'FontSize',11,'FontWeight','bold', ...
        'BackgroundColor',[0.82 0.84 0.92],'ForegroundColor',[0.15 0.25 0.50], ...
        'Callback',@onShowHelp);

    S.btnFolder = uicontrol(LP,'Style','pushbutton','String','📁  Select Folder', ...
        'Units','pixels','Position',[10 817 248 30], ...
        'FontSize',10,'BackgroundColor',[0.30 0.50 0.80],'ForegroundColor','w', ...
        'Callback',@onSelectFolder);

    S.lblFolder = uicontrol(LP,'Style','text','String','No folder selected', ...
        'Units','pixels','Position',[10 789 248 22], ...
        'FontSize',8,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.45 0.45 0.50],'HorizontalAlignment','center');

    uicontrol(LP,'Style','text','String','Files:', ...
        'Units','pixels','Position',[10 767 100 18], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.94 0.94 0.96],'ForegroundColor',[0.20 0.20 0.20], ...
        'HorizontalAlignment','left');

    S.lblConfigCount = uicontrol(LP,'Style','text','String','', ...
        'Units','pixels','Position',[110 767 148 18], ...
        'FontSize',8,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.30 0.60 0.25],'HorizontalAlignment','right');

    uicontrol(LP,'Style','text','String','Sort:', ...
        'Units','pixels','Position',[10 743 36 20], ...
        'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'HorizontalAlignment','left');
    S.popSort = uicontrol(LP,'Style','popupmenu', ...
        'String',{'File name','Wavelength','Pol state','Pol angle','Trial','Individual', ...
                   'Experiment (date/video)','Condition code'}, ...
        'Units','pixels','Position',[48 744 210 22], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onSortChanged);

    S.lstFiles = uicontrol(LP,'Style','listbox','String',{}, ...
        'Units','pixels','Position',[10 lpy(0.47) 248 330], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onFileSelect);

    uicontrol(LP,'Style','text','String','Animal:', ...
        'Units','pixels','Position',[10 lpy(0.443) 248 18], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.94 0.94 0.96],'ForegroundColor',[0.20 0.20 0.20], ...
        'HorizontalAlignment','left');

    S.popAnimal = uicontrol(LP,'Style','popupmenu','String',{' '}, ...
        'Units','pixels','Position',[10 lpy(0.414) 248 22], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onAnimalSelect);

    % ── Pol. angle (per-file, not copied by Copy to All) ─────────────────────
    uicontrol(LP,'Style','text','String','Pol. angle (°):', ...
        'Units','pixels','Position',[10 334 138 22], ...
        'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'HorizontalAlignment','left');
    S.edtPolAngle = uicontrol(LP,'Style','edit','String','0', ...
        'Units','pixels','Position',[152 334 96 22], ...
        'FontSize',9,'BackgroundColor',[1.0 0.97 0.78],'Callback',@onSettingChanged);

    % ── Track settings (per-file, shared via Copy to All) ─────────────────────
    uicontrol(LP,'Style','text','String','── Track ──', ...
        'Units','pixels','Position',[10 310 118 15], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.94 0.94 0.96],'ForegroundColor',[0.30 0.30 0.30], ...
        'HorizontalAlignment','center');
    uicontrol(LP,'Style','pushbutton','String','Copy to All', ...
        'Units','pixels','Position',[133 309 125 17], ...
        'FontSize',8,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.25 0.25 0.55],'Callback',@onCopyToAll);

    lblW = 138; edtW = 96; edtH = 22; ex = 152; lx = 10;
    rows    = [286 260 234 208 182];
    lbls    = {'FPS:','Scale (cm/px):','Min speed:','ROI center (x,y):','ROI diameter (px):'};
    defs    = {'10','1','0','0,0','0'};
    edtTags = {'edtFPS','edtScale','edtMinSpeed','edtROICenter','edtROIDiam'};
    for k = 1:5
        uicontrol(LP,'Style','text','String',lbls{k}, ...
            'Units','pixels','Position',[lx rows(k) lblW edtH], ...
            'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
            'ForegroundColor',[0.20 0.20 0.20],'HorizontalAlignment','left');
        S.(edtTags{k}) = uicontrol(LP,'Style','edit','String',defs{k}, ...
            'Units','pixels','Position',[ex rows(k) edtW edtH], ...
            'FontSize',9,'BackgroundColor','w','Callback',@onSettingChanged);
    end

    % ── Display settings (folder-level) ──────────────────────────────────────
    uicontrol(LP,'Style','text','String','── Display ──', ...
        'Units','pixels','Position',[10 lpy(0.187) 248 15], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.94 0.94 0.96],'ForegroundColor',[0.30 0.30 0.30], ...
        'HorizontalAlignment','center');

    S.chkPolLine = uicontrol(LP,'Style','checkbox','String','Show pol. line (rose)', ...
        'Units','pixels','Position',[10 145 248 18], ...
        'Value',0,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onSettingChanged);

    S.chkColormap = uicontrol(LP,'Style','checkbox','String','Color: time', ...
        'Units','pixels','Position',[10 123 118 18], ...
        'Value',1,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onColorModeChanged);
    S.chkColorSpeed = uicontrol(LP,'Style','checkbox','String','Color: speed', ...
        'Units','pixels','Position',[132 123 122 18], ...
        'Value',0,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onColorModeChanged);

    S.chkSpeedLock = uicontrol(LP,'Style','checkbox','String','Lock speed axis', ...
        'Units','pixels','Position',[10 103 168 18], ...
        'Value',1,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onChkSpeedLock);
    S.edtSpeedPrctile = uicontrol(LP,'Style','edit','String','95', ...
        'Units','pixels','Position',[183 103 38 20], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onSpeedPrctileChanged);
    uicontrol(LP,'Style','text','String','%ile', ...
        'Units','pixels','Position',[224 103 30 18], ...
        'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'HorizontalAlignment','left');

    S.chkHistLock = uicontrol(LP,'Style','checkbox','String','Lock hist. Y axis', ...
        'Units','pixels','Position',[10 82 140 18], ...
        'Value',0,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onChkHistLock);
    uicontrol(LP,'Style','text','String','Max ROI%:', ...
        'Units','pixels','Position',[150 82 64 18], ...
        'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'HorizontalAlignment','left', ...
        'TooltipString',sprintf(['Omit track points farther than this %% of the\n' ...
            'ROI radius from its center (0 = off).']));
    S.edtROIFilterPct = uicontrol(LP,'Style','edit','String','0', ...
        'Units','pixels','Position',[214 82 44 20], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onROIFilterChanged, ...
        'TooltipString',sprintf(['Omit track points farther than this %% of the\n' ...
            'ROI radius from its center (0 = off).']));

    S.chkTimeCut = uicontrol(LP,'Style','checkbox','String','Time cutoff (s)', ...
        'Units','pixels','Position',[10 60 165 18], ...
        'Value',0,'FontSize',9,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.20 0.20 0.20],'Callback',@onChkTimeCut);
    S.edtTimeCut = uicontrol(LP,'Style','edit','String','60', ...
        'Units','pixels','Position',[178 60 60 20], ...
        'FontSize',9,'BackgroundColor','w','Callback',@onTimeCutChanged);

    S.btnExportFig = uicontrol(LP,'Style','pushbutton','String','💾', ...
        'Units','pixels','Position',[10 28 36 28], ...
        'FontSize',11,'FontWeight','bold', ...
        'BackgroundColor',[0.30 0.50 0.80],'ForegroundColor','w', ...
        'Callback',@onExportActiveFig, ...
        'TooltipString','Export the current (active) figure to TrackPlotter_Figures/');
    S.btnBatch = uicontrol(LP,'Style','pushbutton','String','Batch', ...
        'Units','pixels','Position',[50 28 60 28], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.30 0.50 0.80],'ForegroundColor','w', ...
        'Callback',@onBatchSave, ...
        'TooltipString','Render and save a figure for every file');
    S.btnExport = uicontrol(LP,'Style','pushbutton','String','Export CSV', ...
        'Units','pixels','Position',[114 28 76 28], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.30 0.50 0.80],'ForegroundColor','w', ...
        'Callback',@onExportCSV);
    S.btnFigure = uicontrol(LP,'Style','pushbutton','String','Summary', ...
        'Units','pixels','Position',[194 28 62 28], ...
        'FontSize',9,'FontWeight','bold', ...
        'BackgroundColor',[0.30 0.50 0.80],'ForegroundColor','w', ...
        'Enable','off','Callback',@onMakeFigure, ...
        'TooltipString','Build the behaviour summary figure (enabled after exporting the stats CSV)');

    S.lblStatus = uicontrol(LP,'Style','text','String','', ...
        'Units','pixels','Position',[10 5 248 lpy(0.025)], ...
        'FontSize',8,'BackgroundColor',[0.94 0.94 0.96], ...
        'ForegroundColor',[0.30 0.30 0.30],'HorizontalAlignment','left');

    %% ── Right plot panel ────────────────────────────────────────────────────
    S.plotPanel = uipanel(fig,'Units','pixels','Position',[280 5 1130 890],...
        'BackgroundColor','w','BorderType','line', ...
        'HighlightColor',[0.80 0.80 0.85],'Title','');

    setappdata(fig,'S',S);

    % Auto-reload last folder on startup
    if ~isempty(S.folder) && isfolder(S.folder)
        loadFolder(S.folder);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Callbacks
    %% ══════════════════════════════════════════════════════════════════════════

    function onSelectFolder(~,~)
        S = getappdata(fig,'S');
        d = uigetdir(S.folder,'Select folder with tracking CSV files');
        if isequal(d,0), return; end
        setpref('TrackPlotter','lastFolder',d);
        loadFolder(d);
    end

    function loadFolder(d)
        S = getappdata(fig,'S');
        files = dir(fullfile(d,'*_tracks.csv'));
        if isempty(files), files = dir(fullfile(d,'*.csv')); end
        S.folder       = d;
        S.files        = {files.name};
        S.fileSettings = cell(1, numel(S.files));
        S.tableCache   = containers.Map('KeyType','char','ValueType','any');
        [~,dname]      = fileparts(d);
        S.lblFolder.String = dname;
        setappdata(fig,'S',S);
        loadState();
        scanFolderSpeedMax();
        scanFolderHistMax();
        refreshListDisplay();
        if ~isempty(S.files)
            S = getappdata(fig,'S');
            S.lstFiles.Value = 1;
            setappdata(fig,'S',S);
            loadFile();
        end
        % Re-apply the active sort order to the freshly loaded folder
        S = getappdata(fig,'S');
        if isfield(S,'popSort') && ~isempty(S.files) && S.popSort.Value > 1
            onSortChanged();
        end
        setappdata(fig,'S',S);
        refreshFigureButton();
    end

    function refreshFigureButton()
        % Enable the Summary button if the folder already holds an exported
        % stats CSV (newest *_trackstats.csv); point lastStatsCSV at it.
        S = getappdata(fig,'S');
        if ~isfield(S,'btnFigure'), return; end
        S.lastStatsCSV = '';
        if ~isempty(S.folder)
            cand = dir(fullfile(S.folder, '*_trackstats.csv'));
            if ~isempty(cand)
                [~, newest] = max([cand.datenum]);
                S.lastStatsCSV = fullfile(S.folder, cand(newest).name);
            end
        end
        if isempty(S.lastStatsCSV)
            S.btnFigure.Enable = 'off';
        else
            S.btnFigure.Enable = 'on';
        end
        setappdata(fig,'S',S);
    end

    function onFileSelect(~,~),   loadFile();              end
    function onAnimalSelect(~,~), saveCurrentSettings(); drawPlot(); end

    function onOverviewTrackClick(trackLabel)
    % Clicking a track/bar/polar point in the Overview jumps straight to
    % that individual's single-track view, as if picked from the dropdown.
        S = getappdata(fig,'S');
        idx = find(strcmp(S.popAnimal.String, trackLabel), 1);
        if isempty(idx), return; end
        S.popAnimal.Value = idx;
        setappdata(fig,'S',S);
        onAnimalSelect();
    end

    function onSortChanged(~,~)
        S = getappdata(fig,'S');
        if isempty(S.files), return; end
        n = numel(S.files);
        % Parse {wl}_{pol|dif}_{angle}_t{trial}_i{individual} from each name (legacy)
        wl = nan(n,1); ps = nan(n,1); ang = nan(n,1); tr = nan(n,1); ind = nan(n,1);
        % Parse {date}_{videocode}_{condition}_tracks.csv (this dataset's naming):
        % expKey groups files from the same video/experiment together;
        % condKey groups the same condition/individual code across experiments.
        expKey = repmat({''}, n, 1);  condKey = repmat({''}, n, 1);
        for fi = 1:n
            tk = regexp(S.files{fi}, '^(\d+)_(pol|dif)_(\d+)_t(\d+)_i(\d+)', 'tokens', 'once');
            if ~isempty(tk)
                wl(fi)  = str2double(tk{1});  ps(fi)  = double(strcmp(tk{2},'pol'));
                ang(fi) = str2double(tk{3});  tr(fi)  = str2double(tk{4});
                ind(fi) = str2double(tk{5});
            end
            tkExp = regexp(S.files{fi}, '^(\d+_[A-Za-z0-9]+)_', 'tokens', 'once');
            if ~isempty(tkExp), expKey{fi} = tkExp{1}; end
            tkCond = regexp(S.files{fi}, '_([A-Za-z0-9]+)_tracks\.csv$', 'tokens', 'once');
            if ~isempty(tkCond), condKey{fi} = tkCond{1}; end
        end
        % Remember the currently selected file so the highlight follows it
        curName = '';
        v = S.lstFiles.Value;
        if v >= 1 && v <= n, curName = S.files{v}; end

        opt = S.popSort.Value;   % 1 name, 2 wl, 3 pol state, 4 angle, 5 trial, 6 individual, 7 experiment, 8 condition
        if opt == 1
            [~, ord] = sort(lower(S.files));            % alphabetical (original)
        elseif opt >= 2 && opt <= 6
            base    = [wl ps ang tr ind];              % unmatched -> NaN -> sorts last
            primary = opt - 1;
            cols    = [primary, setdiff(1:5, primary, 'stable')];   % primary then tiebreakers
            [~, ord] = sortrows(base(:, cols));
        elseif opt == 7
            key = lower(strcat(expKey, {'_'}, condKey));   % group by experiment, then condition
            [~, ord] = sort(key);
        else
            key = lower(strcat(condKey, {'_'}, expKey));   % group by condition, then experiment
            [~, ord] = sort(key);
        end
        S.files        = S.files(ord);
        S.fileSettings = S.fileSettings(ord);
        setappdata(fig,'S',S);

        refreshListDisplay();

        S = getappdata(fig,'S');
        newSel = find(strcmp(S.files, curName), 1);
        if isempty(newSel), newSel = 1; end
        S.lstFiles.Value = newSel;
        setappdata(fig,'S',S);
        loadFile();
    end
    function onSettingChanged(~,~), saveCurrentSettings(); drawPlot(); end

    % Colour-by time / speed are mutually exclusive (either off = grey).
    function onColorModeChanged(src,~)
        S = getappdata(fig,'S');
        if src == S.chkColorSpeed && src.Value
            S.chkColormap.Value = 0;
        elseif src == S.chkColormap && src.Value
            S.chkColorSpeed.Value = 0;
        end
        onSettingChanged();
    end
    function onBatchSave(~,~),    batchSave();             end

    function onSpeedPrctileChanged(~,~)
        S = getappdata(fig,'S');
        S.speedPrctile = parseNum(S.edtSpeedPrctile.String, 95, 1, 100);
        setappdata(fig,'S',S);
        saveState();
        scanFolderSpeedMax();
        if S.chkHistLock.Value, scanFolderHistMax(); end
        drawPlot();
    end

    function onChkSpeedLock(~,~), saveState(); drawPlot(); end

    function onChkHistLock(~,~)
        S = getappdata(fig,'S');
        if S.chkHistLock.Value && (S.globalHistMaxSpd == 0 || S.globalHistMaxDir == 0)
            scanFolderHistMax();
        end
        saveState();
        drawPlot();
    end

    function onExportCSV(~,~),       exportCSV();          end
    function onMakeFigure(~,~),      makeFigure();         end
    function onExportActiveFig(~,~), exportActiveFigure(); end
    function onShowHelp(~,~),      showHelp();   end

    function onChkTimeCut(~,~)
        saveState();
        drawPlot();
    end

    function onTimeCutChanged(~,~)
        S = getappdata(fig,'S');
        S.chkTimeCut.Value = 1;
        setappdata(fig,'S',S);
        saveState();
        drawPlot();
    end

    function onROIFilterChanged(~,~)
        saveState();
        drawPlot();
    end

    function onCopyToAll(~,~)
        S = getappdata(fig,'S');
        if isempty(S.files) || isempty(S.data), return; end
        saveCurrentSettings();
        S = getappdata(fig,'S');
        idx = S.lstFiles.Value;
        src = S.fileSettings{idx};
        if isempty(src), return; end
        for fi = 1:numel(S.files)
            dst = src;
            % Preserve each file's own pol angle and ROI (arena position/size
            % is specific to that file's video, not something to copy across).
            % A file with no settings yet hasn't been auto-filled from its own
            % CSV's ROI_cx/cy/diam columns (loadFile does that on first visit,
            % and only when roiD isn't already >0) — zero it out here rather
            % than taking the source's ROI, so that auto-fill still runs then.
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi})
                dst.polAng = S.fileSettings{fi}.polAng;
                dst.roiCx  = S.fileSettings{fi}.roiCx;
                dst.roiCy  = S.fileSettings{fi}.roiCy;
                dst.roiD   = S.fileSettings{fi}.roiD;
            else
                dst.roiCx = 0;
                dst.roiCy = 0;
                dst.roiD  = 0;
            end
            S.fileSettings{fi} = dst;
        end
        setappdata(fig,'S',S);
        refreshListDisplay();
        saveState();
        S = getappdata(fig,'S');
        S.lblStatus.String = sprintf('Settings copied to all %d files (pol. angle and ROI kept per-file).', numel(S.files));
        setappdata(fig,'S',S);
    end

    function onFigureResize(~,~)
    % The left control panel (LP) keeps its original fixed size — its
    % children are laid out in absolute pixels and don't need to change —
    % but is re-pinned to the top-left corner so it doesn't drift to the
    % middle of a taller/shorter window. The plot panel stretches to fill
    % whatever space remains; its axes use normalized Position vectors
    % (renderInto/renderOverview), so they rescale automatically with it.
        figH = fig.Position(4);  figW = fig.Position(3);
        LP.Position = [5, max(0, figH - 895), 268, 890];
        S = getappdata(fig,'S');
        if isfield(S,'plotPanel') && isgraphics(S.plotPanel)
            S.plotPanel.Position = [280, 5, max(200, figW - 290), max(200, figH - 10)];
        end
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  File loading
    %% ══════════════════════════════════════════════════════════════════════════

    function loadFile()
        S = getappdata(fig,'S');
        if isempty(S.files), return; end
        idx = S.lstFiles.Value;
        if idx < 1 || idx > numel(S.files), return; end

        fpath = fullfile(S.folder, S.files{idx});
        try
            T = getTable(fpath);
        catch ME
            S.lblStatus.String = ['Read error: ' ME.message];
            setappdata(fig,'S',S); return;
        end

        names = findAnimalColumns(T);
        if isempty(names)
            S.lblStatus.String = 'No animal columns (need {Label}_X / _Y).';
            setappdata(fig,'S',S); return;
        end

        S.data        = T;
        S.animalNames = names;
        % Save BEFORE any nested-function call — getSettings does
        % S=getappdata() which overwrites the shared S, wiping data/animalNames.
        setappdata(fig,'S',S);

        if hasOverviewOption(names)
            S.popAnimal.String = [{'— Overview (ALL individuals) —'}, names];
        else
            S.popAnimal.String = names;
        end
        st = getSettings(idx);          % reads appdata → overwrites shared S
        S = getappdata(fig,'S');        % re-fetch (data=T is now safely in appdata)
        S.edtFPS.String      = num2str(st.fps);
        S.edtScale.String    = num2str(st.pxScale);
        S.edtMinSpeed.String = num2str(st.minSpd);
        % Auto-populate pol angle from filename; fallback to saved setting
        tok2 = regexp(S.files{idx}, '^(\d+)_(pol|dif)_(\d+)_t(\d+)_i(\d+)', 'tokens', 'once');
        if ~isempty(tok2)
            S.edtPolAngle.String = num2str(str2double(tok2{3}));
        else
            S.edtPolAngle.String = num2str(st.polAng);
        end
        % ROI: a saved per-file setting wins; otherwise auto-fill from ROI
        % columns embedded in the CSV by AnimalTracker (ROI_cx/cy/diam, row 1).
        if ~(isfield(st,'roiD') && st.roiD > 0)
            tc = T.Properties.VariableNames;
            if all(ismember({'ROI_cx','ROI_cy','ROI_diam'}, tc))
                cD = T.ROI_diam(1);
                if isfinite(cD) && cD > 0
                    st.roiCx = T.ROI_cx(1);
                    st.roiCy = T.ROI_cy(1);
                    st.roiD  = cD;
                    if idx <= numel(S.fileSettings) && ~isempty(S.fileSettings{idx})
                        S.fileSettings{idx}.roiCx = st.roiCx;
                        S.fileSettings{idx}.roiCy = st.roiCy;
                        S.fileSettings{idx}.roiD  = st.roiD;
                    end
                end
            end
        end
        if isfield(st,'roiD') && st.roiD > 0
            S.edtROICenter.String = sprintf('%g,%g', st.roiCx, st.roiCy);
            S.edtROIDiam.String   = num2str(st.roiD);
        else
            S.edtROICenter.String = '0,0';
            S.edtROIDiam.String   = '0';
        end
        % Default to overview for a multi-individual file until the user has
        % explicitly picked a concrete individual for THIS file (viewOverview,
        % persisted per-file) — not just "has this file been visited before",
        % which would flip to the first track as soon as any default settings
        % got saved for it.
        if hasOverviewOption(names) && (~isfield(st,'viewOverview') || st.viewOverview)
            S.popAnimal.Value = 1;
        else
            S.popAnimal.Value = popupValueFromAnimalIndex(min(st.animalIdx, numel(names)), names);
        end

        if isempty(S.fileSettings{idx}), S.fileSettings{idx} = st; end
        if ~isempty(tok2)
            S.fileSettings{idx}.polAng = str2double(tok2{3});
        end

        setappdata(fig,'S',S);
        refreshListDisplay();
        drawPlot();
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Per-file settings persistence
    %% ══════════════════════════════════════════════════════════════════════════

    function saveCurrentSettings()
        S = getappdata(fig,'S');
        if isempty(S.files) || isempty(S.data), return; end
        idx = S.lstFiles.Value;
        if idx < 1 || idx > numel(S.files), return; end
        [roiCx, roiCy] = parseCoordPair(S.edtROICenter.String);
        roiD           = parseNum(S.edtROIDiam.String, 0, 0, inf);
        % Overview has no single "current animal" — keep whatever concrete
        % individual was last selected instead of overwriting it.
        if isOverviewSelected(S)
            animalIdxToSave = 1;
            if idx <= numel(S.fileSettings) && ~isempty(S.fileSettings{idx})
                animalIdxToSave = S.fileSettings{idx}.animalIdx;
            end
        else
            animalIdxToSave = animalIndexFromPopupValue(S.popAnimal.Value, S.animalNames);
        end
        animalIdxToSave = max(1, min(animalIdxToSave, numel(S.animalNames)));
        S.fileSettings{idx} = struct( ...
            'fps',      parseNum(S.edtFPS.String,       10,  0.001, inf), ...
            'pxScale',  parseNum(S.edtScale.String,     1.0, 0.001, inf), ...
            'minSpd',   parseNum(S.edtMinSpeed.String,  0,   0,     inf), ...
            'polAng',   parseNum(S.edtPolAngle.String,  0,  -inf,   inf), ...
            'roiCx',    roiCx, ...
            'roiCy',    roiCy, ...
            'roiD',     roiD, ...
            'animalIdx', animalIdxToSave, ...
            'viewOverview', isOverviewSelected(S));
        setappdata(fig,'S',S);
        refreshListDisplay();
        saveState();
    end

    function st = getSettings(idx)
        S = getappdata(fig,'S');
        if idx <= numel(S.fileSettings) && ~isempty(S.fileSettings{idx})
            st = S.fileSettings{idx};
        else
            st = defSt();
        end
    end

    function refreshListDisplay()
        S = getappdata(fig,'S');
        if isempty(S.files), return; end
        nConf   = 0;
        display = cell(size(S.files));
        for fi = 1:numel(S.files)
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi})
                display{fi} = ['✓  ' S.files{fi}];
                nConf = nConf + 1;
            else
                display{fi} = ['    ' S.files{fi}];
            end
        end
        prev = S.lstFiles.Value;
        S.lstFiles.String = display;
        S.lstFiles.Value  = max(1, min(prev, numel(display)));
        S.lblConfigCount.String = sprintf('%d / %d reviewed', nConf, numel(S.files));
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Live drawing
    %% ══════════════════════════════════════════════════════════════════════════

    function drawPlot()
        S = getappdata(fig,'S');
        if isempty(S.animalNames) || isempty(S.data), return; end
        overview = isOverviewSelected(S);
        ai  = max(1, min(animalIndexFromPopupValue(S.popAnimal.Value, S.animalNames), numel(S.animalNames)));
        lbl = S.animalNames{ai};
        [roiCx, roiCy] = parseCoordPair(S.edtROICenter.String);
        roiD           = parseNum(S.edtROIDiam.String, 0, 0, inf);
        st  = struct( ...
            'fps',        parseNum(S.edtFPS.String,      10,  0.001, inf), ...
            'pxScale',    parseNum(S.edtScale.String,    1.0, 0.001, inf), ...
            'minSpd',     parseNum(S.edtMinSpeed.String, 0,   0,     inf), ...
            'polAng',     parseNum(S.edtPolAngle.String, 0,  -inf,   inf), ...
            'roiCx',      roiCx, ...
            'roiCy',      roiCy, ...
            'roiD',       roiD, ...
            'roiFilterPct', parseNum(S.edtROIFilterPct.String, 0, 0, 1000), ...
            'useColormap', logical(S.chkColormap.Value), ...
            'useSpeedColor', logical(S.chkColorSpeed.Value), ...
            'showPolLine', logical(S.chkPolLine.Value), ...
            'speedMax',    S.globalSpeedMax, ...
            'lockSpeed',   logical(S.chkSpeedLock.Value), ...
            'lockHist',    logical(S.chkHistLock.Value), ...
            'histMaxSpd',  S.globalHistMaxSpd, ...
            'histMaxDir',  S.globalHistMaxDir, ...
            'timeCut',     logical(S.chkTimeCut.Value), ...
            'timeCutVal',  parseNum(S.edtTimeCut.String, inf, 0, inf));
        delete(findobj(S.plotPanel,'Type','axes'));
        try
            if overview
                renderOverview(S.plotPanel, S.data, S.animalNames, st, S.files{S.lstFiles.Value}, S.folder);
                S.lblStatus.String = sprintf('%s  |  Overview  |  %d individuals  |  %d frames', ...
                    S.files{S.lstFiles.Value}, numel(S.animalNames), height(S.data));
            else
                renderInto(S.plotPanel, S.data, lbl, st, S.files{S.lstFiles.Value});
                S.lblStatus.String = sprintf('%s  |  %s  |  %d frames', ...
                    S.files{S.lstFiles.Value}, strrep(lbl,'_',' '), height(S.data));
            end
        catch ME
            S.lblStatus.String = ['Error: ' ME.message];
            errordlg(getReport(ME,'basic','hyperlinks','off'), 'TrackPlotter error');
        end
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Export the single active (currently displayed) figure
    %% ══════════════════════════════════════════════════════════════════════════

    function exportActiveFigure()
        S = getappdata(fig,'S');
        if isempty(S.files) || isempty(S.data)
            S.lblStatus.String = 'No active figure to export — load a file first.';
            setappdata(fig,'S',S); return;
        end
        saveCurrentSettings();
        S = getappdata(fig,'S');
        idx = S.lstFiles.Value;
        overview = isOverviewSelected(S);
        ai  = max(1, min(animalIndexFromPopupValue(S.popAnimal.Value, S.animalNames), numel(S.animalNames)));
        lbl = S.animalNames{ai};
        [roiCx, roiCy] = parseCoordPair(S.edtROICenter.String);
        roiD = parseNum(S.edtROIDiam.String, 0, 0, inf);
        st  = struct( ...
            'fps',        parseNum(S.edtFPS.String,      10,  0.001, inf), ...
            'pxScale',    parseNum(S.edtScale.String,    1.0, 0.001, inf), ...
            'minSpd',     parseNum(S.edtMinSpeed.String, 0,   0,     inf), ...
            'polAng',     parseNum(S.edtPolAngle.String, 0,  -inf,   inf), ...
            'roiCx',      roiCx, ...
            'roiCy',      roiCy, ...
            'roiD',       roiD, ...
            'roiFilterPct', parseNum(S.edtROIFilterPct.String, 0, 0, 1000), ...
            'useColormap', logical(S.chkColormap.Value), ...
            'useSpeedColor', logical(S.chkColorSpeed.Value), ...
            'showPolLine', logical(S.chkPolLine.Value), ...
            'speedMax',    S.globalSpeedMax, ...
            'lockSpeed',   logical(S.chkSpeedLock.Value), ...
            'lockHist',    logical(S.chkHistLock.Value), ...
            'histMaxSpd',  S.globalHistMaxSpd, ...
            'histMaxDir',  S.globalHistMaxDir, ...
            'timeCut',     logical(S.chkTimeCut.Value), ...
            'timeCutVal',  parseNum(S.edtTimeCut.String, inf, 0, inf));

        outDir = fullfile(S.folder, 'TrackPlotter_Figures');
        if ~exist(outDir,'dir'), mkdir(outDir); end

        fout = figure('Visible','off','Color','w', ...
            'Units','centimeters','Position',[1 1 28 18]);
        fout.PaperUnits    = 'centimeters';
        fout.PaperSize     = [28 18];
        fout.PaperPosition = [0 0 28 18];
        if overview
            renderOverview(fout, S.data, S.animalNames, st, S.files{idx}, S.folder);
        else
            renderInto(fout, S.data, lbl, st, S.files{idx});
        end

        [~,stem] = fileparts(S.files{idx});
        if overview
            outPath = fullfile(outDir, sprintf('%s_overview.pdf', stem));
            tagStr  = 'overview';
        else
            outPath = fullfile(outDir, sprintf('%s_%s.pdf', stem, lbl));
            tagStr  = lbl;
        end
        saved = false;
        try   print(fout, outPath, '-dpdf'); saved = true; catch; end
        if ~saved, try exportgraphics(fout,outPath,'ContentType','vector'); saved=true; catch; end, end
        if ~saved, try exportgraphics(fout,outPath,'Resolution',150); saved=true; catch; end, end
        delete(fout);

        if saved
            S.lblStatus.String = sprintf('Saved active figure → TrackPlotter_Figures/%s_%s.pdf', stem, tagStr);
        else
            S.lblStatus.String = sprintf('Export FAILED for %s_%s.pdf', stem, tagStr);
            errordlg(sprintf('Could not export a figure for %s (%s).\nCheck that %s is writable.', ...
                S.files{idx}, tagStr, outDir), 'TrackPlotter export error');
        end
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Batch save
    %% ══════════════════════════════════════════════════════════════════════════

    function batchSave()
        S = getappdata(fig,'S');
        if isempty(S.files)
            S.lblStatus.String = 'No files loaded.';
            setappdata(fig,'S',S); return;
        end
        saveCurrentSettings();
        S = getappdata(fig,'S');

        outDir = fullfile(S.folder, 'TrackPlotter_Figures');
        if ~exist(outDir,'dir'), mkdir(outDir); end

        nFiles = numel(S.files);
        nSaved = 0;
        nOverviewSaved = 0;
        failedFiles = {};
        failedOverviewFiles = {};
        for fi = 1:nFiles
            fpath = fullfile(S.folder, S.files{fi});
            try T = getTable(fpath); catch; continue; end

            names = findAnimalColumns(T);
            if isempty(names), continue; end

            st  = getSettings(fi);
            S = getappdata(fig,'S');        % re-fetch after getSettings
            st.useColormap = logical(S.chkColormap.Value);
            st.useSpeedColor = logical(S.chkColorSpeed.Value);
            st.showPolLine = logical(S.chkPolLine.Value);
            st.speedMax    = S.globalSpeedMax;
            st.lockSpeed   = logical(S.chkSpeedLock.Value);
            st.lockHist    = logical(S.chkHistLock.Value);
            st.histMaxSpd  = S.globalHistMaxSpd;
            st.histMaxDir  = S.globalHistMaxDir;
            st.timeCut     = logical(S.chkTimeCut.Value);
            st.timeCutVal  = parseNum(S.edtTimeCut.String, inf, 0, inf);
            st.roiFilterPct = parseNum(S.edtROIFilterPct.String, 0, 0, 1000);
            lbl = names{min(st.animalIdx, numel(names))};

            fout = figure('Visible','off','Color','w', ...
                'Units','centimeters','Position',[1 1 28 18]);
            fout.PaperUnits    = 'centimeters';
            fout.PaperSize     = [28 18];
            fout.PaperPosition = [0 0 28 18];

            renderInto(fout, T, lbl, st, S.files{fi});

            [~,stem] = fileparts(S.files{fi});
            outPath  = fullfile(outDir, sprintf('%s_%s.pdf', stem, lbl));
            saved = false;
            try   print(fout, outPath, '-dpdf'); saved = true; catch; end
            if ~saved
                try exportgraphics(fout,outPath,'ContentType','vector'); saved=true; catch; end
            end
            if ~saved
                try exportgraphics(fout,outPath,'Resolution',150); saved=true; catch; end
            end
            delete(fout);
            if saved
                nSaved = nSaved + 1;
            else
                failedFiles{end+1} = S.files{fi}; %#ok<AGROW>
            end

            % Multi-individual file → also save the all-individuals overview.
            if hasOverviewOption(names)
                foutOv = figure('Visible','off','Color','w', ...
                    'Units','centimeters','Position',[1 1 28 18]);
                foutOv.PaperUnits    = 'centimeters';
                foutOv.PaperSize     = [28 18];
                foutOv.PaperPosition = [0 0 28 18];

                renderOverview(foutOv, T, names, st, S.files{fi}, S.folder);

                outPathOv = fullfile(outDir, sprintf('%s_overview.pdf', stem));
                savedOv = false;
                try   print(foutOv, outPathOv, '-dpdf'); savedOv = true; catch; end
                if ~savedOv
                    try exportgraphics(foutOv,outPathOv,'ContentType','vector'); savedOv=true; catch; end
                end
                if ~savedOv
                    try exportgraphics(foutOv,outPathOv,'Resolution',150); savedOv=true; catch; end
                end
                delete(foutOv);
                if savedOv
                    nOverviewSaved = nOverviewSaved + 1;
                else
                    failedOverviewFiles{end+1} = S.files{fi}; %#ok<AGROW>
                end
            end

            S.lblStatus.String = sprintf('Saving %d / %d …  %s', fi, nFiles, S.files{fi});
            setappdata(fig,'S',S);
            drawnow;
        end

        nFailed = numel(failedFiles) + numel(failedOverviewFiles);
        if nFailed == 0
            S.lblStatus.String = sprintf('Done — %d saved + %d overviews → TrackPlotter_Figures/', nSaved, nOverviewSaved);
        else
            S.lblStatus.String = sprintf('Done — %d saved + %d overviews, %d FAILED → TrackPlotter_Figures/ (see Command Window)', ...
                nSaved, nOverviewSaved, nFailed);
            fprintf('TrackPlotter: failed to export a figure for:\n');
            if ~isempty(failedFiles),          fprintf('  %s\n', failedFiles{:}); end
            if ~isempty(failedOverviewFiles),  fprintf('  %s (overview)\n', failedOverviewFiles{:}); end
        end
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Core rendering — works for uipanel (live) OR figure (batch save)
    %% ══════════════════════════════════════════════════════════════════════════

    function renderInto(parent, T, lbl, st, fname)
        posX    = T.([lbl '_X']);
        posY    = T.([lbl '_Y']);
        nFrames = height(T);

        fps     = st.fps;
        pxScale = st.pxScale;
        minSpd  = st.minSpd;
        polAng  = st.polAng;
        roiCx = 0; roiCy = 0; roiD = 0;
        if isfield(st,'roiCx'), roiCx = st.roiCx; end
        if isfield(st,'roiCy'), roiCy = st.roiCy; end
        if isfield(st,'roiD'),  roiD  = st.roiD;  end
        if pxScale == 1
            posUnit = 'px';  spdUnit = 'px/s';
        else
            posUnit = 'cm';  spdUnit = 'cm/s';
        end
        lockSpeed = isfield(st,'lockSpeed') && st.lockSpeed;
        spdAxisMax = 0;
        if lockSpeed && isfield(st,'speedMax') && st.speedMax > 0
            spdAxisMax = st.speedMax * 1.15;
        end
        lockHist  = isfield(st,'lockHist') && st.lockHist;
        histMaxSpd = 0;  histMaxDir = 0;
        if lockHist
            if isfield(st,'histMaxSpd') && st.histMaxSpd > 0, histMaxSpd = st.histMaxSpd; end
            if isfield(st,'histMaxDir') && st.histMaxDir > 0, histMaxDir = st.histMaxDir; end
        end

        % Apply time cutoff before any computation
        if isfield(st,'timeCut') && st.timeCut && isfield(st,'timeCutVal') && isfinite(st.timeCutVal)
            cutIdx = floor(st.timeCutVal * fps) + 1;
            if cutIdx >= 1 && cutIdx <= nFrames
                posX(cutIdx:end) = NaN;
                posY(cutIdx:end) = NaN;
            end
        end
        if isfield(st,'roiFilterPct')
            [posX, posY] = applyROIFilter(posX, posY, roiCx, roiCy, roiD, st.roiFilterPct);
        end

        useSpeedColor = isfield(st,'useSpeedColor') && st.useSpeedColor;
        useColormap   = ~useSpeedColor && (~isfield(st,'useColormap') || st.useColormap);
        if useColormap || useSpeedColor
            cmap = parula(256);
        else
            cmap = repmat([0.35 0.35 0.35], 256, 1);
        end
        nBins   = 24;
        edges   = linspace(-pi, pi, nBins+1);
        th_c    = linspace(0, 2*pi, 120);
        cardTh  = [0, pi/2, pi, -pi/2];
        cardLbl = {'0°','90°','180°','-90°'};
        col     = [0.15 0.45 0.75];

        titleH = 0.06;  rowH = 1 - titleH;  rBot = 0;

        % ── Title ─────────────────────────────────────────────────────────────
        axT = axes('Parent',parent,'Position',[0 1-titleH 1 titleH]);
        axT.Visible = 'off';
        text(0.02, 0.5, fname, ...
            'Interpreter','none','HorizontalAlignment','left', ...
            'VerticalAlignment','middle','FontSize',10,'FontWeight','bold', ...
            'Color',[0.15 0.15 0.15],'Units','normalized');
        text(0.98, 0.5, strrep(lbl,'_',' '), ...
            'Interpreter','none','HorizontalAlignment','right', ...
            'VerticalAlignment','middle','FontSize',10,'FontWeight','bold', ...
            'Color',col,'Units','normalized');

        % ── Pre-compute speed / direction ─────────────────────────────────────
        dx    = diff(posX);  dy = diff(posY);
        spd_v = sqrt(dx.^2 + dy.^2);
        dir_v = atan2d(dy, dx);
        vp    = ~isnan(posX(1:end-1)) & ~isnan(posX(2:end));
        fr = [];  sv_raw = [];  sv_smooth = [];  dv = [];
        if any(vp)
            fr        = find(vp) + 1;
            sv_raw    = spd_v(vp) * pxScale * fps;
            sv_smooth = sv_raw;
            if numel(sv_smooth) >= 5, sv_smooth = movmean(sv_smooth, 5); end
            dv = dir_v(vp);
        end
        fr_d = [];  sv_d = [];  dv_d = [];
        if ~isempty(sv_raw)
            dm   = sv_raw >= minSpd;
            fr_d = fr(dm);  sv_d = sv_raw(dm);  dv_d = dv(dm);
        end

        % ── Speed-colour helpers ──────────────────────────────────────────────
        % Per-position speed (aligned to posX/posY) and a value→colour-index map
        % shared across panels so the colour gradient encodes speed consistently.
        spdPos = nan(nFrames,1);
        if nFrames >= 2, spdPos(2:end) = spd_v * pxScale * fps; spdPos(1) = spdPos(2); end
        speedColorMax = 1;
        if ~isempty(sv_raw), speedColorMax = max(prctile(sv_raw,99), eps); end
        % Speed→colour via the empirical CDF (histogram equalisation): colours
        % are allocated by how speeds are actually distributed, so the densely
        % populated slow range gets most of the colormap and rare fast bursts
        % don't dominate it.  Falls back to linear if there is no data.
        % Rank lookup via interp1 on the unique sorted speeds (O(n log n)),
        % instead of an O(n·m) broadcast comparison against every query value
        % (which cost O(nFrames^2) per panel on long tracks).
        spdSorted = sort(sv_raw(:));
        nSpd      = numel(spdSorted);
        if nSpd > 0
            [uSpd, uRank] = unique(spdSorted, 'last');   % uRank(i) = #speeds <= uSpd(i)
            if isscalar(uSpd)
                fixedIdx = max(1, min(256, round(uRank/nSpd*255)+1));
                spdIdx = @(v) repmat(fixedIdx, 1, numel(v));
            else
                spdIdx = @(v) max(1, min(256, ...
                    round(interp1(uSpd, uRank, v(:)', 'linear', 'extrap') / nSpd * 255) + 1));
            end
        else
            spdIdx = @(v) ones(1, numel(v));
        end
        frmIdx = @(v) max(1, min(256, round((v(:)'-1) / max(nFrames-1,1) * 255) + 1));

        % ── Tortuosity and speed variability ──────────────────────────────────
        totalDist = 0;
        netDisp = NaN;  SI = NaN;  meanAbsTurn = NaN;  cvSpd = NaN;
        if any(vp)
            totalDist = sum(spd_v(vp)) * pxScale;
            vld = find(~isnan(posX));
            if numel(vld) >= 2
                netDisp = sqrt((posX(vld(end))-posX(vld(1)))^2 + ...
                               (posY(vld(end))-posY(vld(1)))^2) * pxScale;
                if totalDist > 1e-9, SI = netDisp / totalDist; end
            end
        end
        if numel(dv_d) >= 2
            td = mod(diff(dv_d) + 180, 360) - 180;
            meanAbsTurn = mean(abs(td));
        end
        if numel(sv_d) >= 2
            cvSpd = std(sv_d) / mean(sv_d);
        end

        % ── Panel 1: Track scatter ─────────────────────────────────────────
        ax1 = axes('Parent',parent,'Position',[0.04 rBot+0.51*rowH+30/830 0.24 0.40*rowH]);
        hold(ax1,'on'); ax1.Color='w'; grid(ax1,'on'); box(ax1,'on');
        ax1.XColor=[0.3 0.3 0.3]; ax1.YColor=[0.3 0.3 0.3];
        ax1.GridColor=[0.88 0.88 0.88]; ax1.GridAlpha=1;
        % Track_X/Y follow video/image pixel convention (row 0 at the top,
        % increasing downward) — match it here too (see renderOverview's
        % Panel A) so a track looks right-side-up relative to the arena,
        % and so the two views of the same file agree with each other.
        ax1.YDir = 'reverse';
        xlabel(ax1,['X (' posUnit ')'],'FontSize',8);
        ylabel(ax1,['Y (' posUnit ')'],'FontSize',8);
        t1 = title(ax1,'Track','FontSize',8);
        t1.Units = 'pixels'; t1.Position(2) = t1.Position(2) + 20;
        valid = find(~isnan(posX));
        if ~isempty(valid)
            if useSpeedColor
                vSpd = spdPos(valid);  vSpd(isnan(vSpd)) = 0;
                cidx = spdIdx(vSpd);
                clim(ax1,[0 speedColorMax]);
            else
                cidx = max(1, round((valid-1)/max(nFrames-1,1)*255)+1);
                clim(ax1,[1 nFrames]);
            end
            scatter(ax1, posX(valid)*pxScale, posY(valid)*pxScale, 7, cmap(cidx,:), ...
                'filled', 'MarkerFaceAlpha',0.75);
            colormap(ax1, parula);
        end
        % ROI takes priority; video dims are the fallback; otherwise auto-scale.
        if roiD > 0
            r1  = roiD * pxScale / 2;
            cx1 = roiCx * pxScale;  cy1 = roiCy * pxScale;
            m1  = r1 * 0.15;
            th1 = linspace(0, 2*pi, 120);
            plot(ax1, cx1 + r1*cos(th1), cy1 + r1*sin(th1), '-', ...
                'Color',[0.82 0.82 0.82],'LineWidth',1.5);
            ax1.XLim = [cx1 - r1 - m1, cx1 + r1 + m1];
            ax1.YLim = [cy1 - r1 - m1, cy1 + r1 + m1];
        end
        axis(ax1,'equal');
        % Equal tick spacing on both axes so grid cells are squares
        axStep = niceStep(max(diff(ax1.XLim), diff(ax1.YLim)), 5);
        ax1.XTick = ceil(ax1.XLim(1)/axStep)*axStep : axStep : ax1.XLim(2);
        ax1.YTick = ceil(ax1.YLim(1)/axStep)*axStep : axStep : ax1.YLim(2);
        if ~isnan(SI)
            tpSubtitle(ax1, sprintf('SI=%.2f  |  turn=%.1f°  |  disp=%.1f %s', ...
                SI, meanAbsTurn, netDisp, posUnit));
        end

        % ── Panel 2: Speed + Direction timeseries ──────────────────────────
        ax2pos = [0.34 rBot+0.51*rowH+30/830 0.28 0.38*rowH];
        ax2 = axes('Parent',parent,'Position',ax2pos);
        hold(ax2,'on'); ax2.Color='w'; grid(ax2,'on'); box(ax2,'on');
        figGrey = [0.45 0.45 0.50];
        ax2.XColor=[0.3 0.3 0.3]; ax2.YColor=figGrey;
        ax2.GridColor=[0.88 0.88 0.88]; ax2.GridAlpha=1;
        xlabel(ax2,'Frame','FontSize',8);
        ylabel(ax2,['Speed (' spdUnit ')'],'FontSize',8,'Color',figGrey);
        t2 = title(ax2,'Speed & Direction','FontSize',8);
        t2.Units = 'pixels'; t2.Position(2) = t2.Position(2) + 30;

        ax2r = axes('Parent',parent,'Position',ax2pos, ...
            'YAxisLocation','right','Color','none', ...
            'XColor','none','YColor',col,'FontSize',7,'Box','off','XTick',[]);
        hold(ax2r,'on');
        ylabel(ax2r,'Dir (°)','FontSize',8,'Color',col);
        ax2r.YLim=[-180 180]; ax2r.YTick=[-180 -90 0 90 180];
        ax2r.YTickLabel={'±180','−90','0','90','180'};
        linkaxes([ax2 ax2r],'x');
        plot(ax2r,[1 nFrames],[0 0],':','Color',[0.75 0.75 0.75],'LineWidth',0.8);
        if ~isempty(fr)
            scatter(ax2,  fr,   sv_smooth, 5, [0.72 0.72 0.72], 'filled');
            if ~isempty(fr_d)
                if useSpeedColor
                    cidxD = spdIdx(sv_d);
                else
                    cidxD = max(1, round((fr_d-1)/max(nFrames-1,1)*255)+1);
                end
                scatter(ax2r, fr_d, dv_d, 5, cmap(cidxD,:), 'filled', 'MarkerFaceAlpha',0.65);
            end
            % Smoothed trend lines, drawn on top of the raw/smoothed scatter.
            % Speed already has a 5-frame moving average (sv_smooth); just
            % draw it as a line too. Direction needs a CIRCULAR moving
            % average (plain movmean on degrees breaks at the ±180° wrap,
            % e.g. averaging +179° and -179° would wrongly give ~0°) — done
            % via the unit-vector components, then re-broken into separate
            % segments at any remaining wrap so the line doesn't draw a
            % spurious vertical jump across it.
            plot(ax2, fr(:), sv_smooth(:), '-', 'Color',[0.30 0.30 0.30], 'LineWidth',1.1);
            if numel(dv) >= 5
                dv_sm = atan2d(movmean(sind(dv(:)),5), movmean(cosd(dv(:)),5));
            else
                dv_sm = dv(:);
            end
            if ~isempty(dv_sm)
                frW = fr(:);  dvW = dv_sm;
                wrapAt = find(abs(diff(dvW)) > 180);
                for k = numel(wrapAt):-1:1
                    wi = wrapAt(k);
                    dvW = [dvW(1:wi); NaN; dvW(wi+1:end)]; %#ok<AGROW>
                    frW = [frW(1:wi); frW(wi); frW(wi+1:end)]; %#ok<AGROW>
                end
                plot(ax2r, frW, dvW, '-', 'Color', col, 'LineWidth', 1.1);
            end
            ax2.XLim=[1 nFrames];
            ymax2 = max(prctile(sv_smooth,95)*1.15, 1);
            if spdAxisMax > 0, ymax2 = spdAxisMax; end
            ax2.YLim=[0 ymax2];
            ax2t = axes('Parent',parent,'Position',ax2pos, ...
                'XAxisLocation','top','Color','none', ...
                'XColor',[0.3 0.3 0.3],'YColor','none', ...
                'FontSize',7,'Box','off','YTick',[]);
            dur2 = (nFrames-1) / fps;
            ax2t.XLim=[0 dur2]; ax2t.XTick=0:niceStep(dur2,5):dur2;
            xlabel(ax2t,'Time (s)','FontSize',8,'Color',[0.3 0.3 0.3]);
        end
        if isfield(st,'timeCut') && st.timeCut && isfield(st,'timeCutVal') && isfinite(st.timeCutVal)
            cutIdx = floor(st.timeCutVal * fps) + 1;
            if cutIdx >= 1 && cutIdx <= nFrames
                xline(ax2, cutIdx, '--', 'Color',[0.80 0.15 0.15], 'LineWidth',1.5);
            end
        end

        % ── Panel 3: Rose (360° direction histogram) — bottom-left ───────────
        ax3 = axes('Parent',parent,'Position',[0.04 rBot+0.07*rowH 0.24 0.38*rowH]);
        hold(ax3,'on'); axis(ax3,'equal'); axis(ax3,'off'); ax3.Color='w';
        title(ax3,'Direction (360°)','FontSize',8);
        dr3 = atan2(dy(vp), dx(vp));
        if ~isempty(dr3)
            cnt  = histcounts(dr3, edges);
            cnt  = cnt / max(sum(cnt), 1);
            maxR = max(cnt(:));  if maxR < 1e-6, maxR = 1; end
            for bi = 1:nBins
                if cnt(bi) < 1e-6, continue; end
                th = linspace(edges(bi), edges(bi+1), 10);
                r  = cnt(bi) / maxR;
                % Color wedge by mean frame time (or mean speed) of its observations
                if bi < nBins
                    inW = dr3 >= edges(bi) & dr3 < edges(bi+1);
                else
                    inW = dr3 >= edges(bi) & dr3 <= edges(bi+1);
                end
                if useSpeedColor
                    cW = sv_raw(inW);  idxFn = spdIdx;
                else
                    cW = fr(inW);      idxFn = frmIdx;
                end
                if isempty(cW)
                    wc = col;
                else
                    wc = cmap(idxFn(mean(cW)),:);
                end
                patch(ax3,[0,r*cos(th),0],[0,r*sin(th),0],wc, ...
                    'FaceAlpha',0.80,'EdgeColor','none');
            end
        end
        for gr = [0.25 0.5 0.75 1.0]
            plot(ax3,gr*cos(th_c),gr*sin(th_c),'-','Color',[0.80 0.80 0.80],'LineWidth',0.5);
        end
        for ci = 1:4
            plot(ax3,[0 1.05]*cos(cardTh(ci)),[0 1.05]*sin(cardTh(ci)),'-', ...
                'Color',[0.75 0.75 0.75],'LineWidth',0.5);
            text(ax3,1.14*cos(cardTh(ci)),1.14*sin(cardTh(ci)),cardLbl{ci}, ...
                'HorizontalAlignment','center','FontSize',7,'Color',[0.4 0.4 0.4]);
        end
        plot(ax3,cos(th_c),sin(th_c),'-','Color',[0.6 0.6 0.6],'LineWidth',1);
        ax3.XLim=[-1.3 1.3]; ax3.YLim=[-1.3 1.3];

        % ── Polaroid orientation arrow ─────────────────────────────────────
        if isfield(st,'showPolLine') && st.showPolLine
            polRad   = deg2rad(polAng);
            r_line   = 1.05;
            arrowLen = 0.10;
            arrowW   = 0.055;
            plot(ax3, [-r_line*cos(polRad),  r_line*cos(polRad)], ...
                      [-r_line*sin(polRad),  r_line*sin(polRad)], ...
                'k-', 'LineWidth', 0.8);
            for sgn = [1 -1]
                tx = sgn * r_line * cos(polRad);
                ty = sgn * r_line * sin(polRad);
                bx = tx - sgn * arrowLen * cos(polRad);
                by = ty - sgn * arrowLen * sin(polRad);
                px = -sin(polRad);  py = cos(polRad);
                patch(ax3, [tx, bx + arrowW*px, bx - arrowW*px], ...
                           [ty, by + arrowW*py, by - arrowW*py], ...
                    'k', 'EdgeColor', 'none');
            end
        end

        % ── Panel 4: Speed histogram — top-right ──────────────────────────
        ax4 = axes('Parent',parent,'Position',[0.70 rBot+0.51*rowH+30/830 0.26 0.40*rowH]);
        hold(ax4,'on'); ax4.Color='w'; grid(ax4,'on'); box(ax4,'on');
        ax4.XColor=[0.3 0.3 0.3]; ax4.YColor=[0.3 0.3 0.3];
        ax4.GridColor=[0.88 0.88 0.88]; ax4.GridAlpha=1;
        xlabel(ax4,['Speed (' spdUnit ')'],'FontSize',8);
        ylabel(ax4,'Count','FontSize',8);
        title(ax4,'Speed Distribution','FontSize',8);
        if ~isempty(sv_raw)
            hiSpd4 = max(sv_raw) * 1.001;
            if spdAxisMax > 0, hiSpd4 = spdAxisMax; end
            edges4 = linspace(0, hiSpd4, 21);
            if useSpeedColor
                gradientBar(ax4, edges4, sv_raw, sv_raw, spdIdx, cmap);
            else
                gradientBar(ax4, edges4, sv_raw, fr, frmIdx, cmap);
            end
            cnts4  = histcounts(sv_raw, edges4);
            ax4.XLim = [0 hiSpd4];
            if lockHist && histMaxSpd > 0
                ax4.YLim = [0 histMaxSpd * 1.15];
            else
                ax4.YLim = [0 max(max(cnts4)*1.15, 1)];
            end
            nOff = sum(sv_raw > hiSpd4);
            subStr = sprintf('median %.2f %s  |  dist %.1f %s', median(sv_raw), spdUnit, totalDist, posUnit);
            if ~isnan(cvSpd)
                subStr = sprintf('%s  |  CV=%.2f', subStr, cvSpd);
            end
            if nOff > 0
                subStr = sprintf('%s  |  %d off-scale', subStr, nOff);
            end
            tpSubtitle(ax4, subStr);
            if minSpd > 0
                xline(ax4, minSpd, '--', 'Color',[0.75 0.20 0.20], 'LineWidth',1.2);
            end
        end

        % ── Panel 5: Speed vs Direction scatter ────────────────────────────
        ax5 = axes('Parent',parent,'Position',[0.34 rBot+0.07*rowH 0.28 0.38*rowH]);
        hold(ax5,'on'); ax5.Color='w'; grid(ax5,'on'); box(ax5,'on');
        ax5.XColor=[0.3 0.3 0.3]; ax5.YColor=[0.3 0.3 0.3];
        ax5.GridColor=[0.88 0.88 0.88]; ax5.GridAlpha=1;
        xlabel(ax5,'Direction (°)','FontSize',8);
        ylabel(ax5,['Speed (' spdUnit ')'],'FontSize',8);
        title(ax5,'Speed vs Direction','FontSize',8);
        ax5.XLim=[-180 180]; ax5.XTick=[-180 -90 0 90 180];
        % Faded layer: points below the speed cutoff
        if minSpd > 0 && ~isempty(fr)
            dm_ex = sv_raw < minSpd;
            if any(dm_ex)
                if useSpeedColor
                    cidx_ex = spdIdx(sv_raw(dm_ex));
                else
                    cidx_ex = max(1, round((fr(dm_ex)-1)/max(nFrames-1,1)*255)+1);
                end
                scatter(ax5, dv(dm_ex), sv_raw(dm_ex), 8, cmap(cidx_ex,:), ...
                    'filled', 'MarkerFaceAlpha',0.12);
            end
        end
        % Main layer: points at or above the speed cutoff
        if ~isempty(fr_d)
            if useSpeedColor
                cidx5 = spdIdx(sv_d);
            else
                cidx5 = max(1, round((fr_d-1)/max(nFrames-1,1)*255)+1);
            end
            scatter(ax5, dv_d, sv_d, 8, cmap(cidx5,:), 'filled', 'MarkerFaceAlpha',0.65);
        end
        % Pin Y to the full (unfiltered) speed range so the cutoff line
        % doesn't cause the axis to rescale when minSpd is introduced.
        if ~isempty(sv_raw)
            ymax5 = max(prctile(sv_raw, 99) * 1.15, 0.1);
            if spdAxisMax > 0, ymax5 = spdAxisMax; end
            ax5.YLim = [0 ymax5];
        end
        if minSpd > 0
            yline(ax5, minSpd, '--', 'Color',[0.75 0.20 0.20], 'LineWidth',1.2);
        end

        % ── Panel 6: Direction 0–180° (axial) ──────────────────────────────
        ax6 = axes('Parent',parent,'Position',[0.70 rBot+0.07*rowH 0.26 0.38*rowH]);
        hold(ax6,'on'); ax6.Color='w'; grid(ax6,'on'); box(ax6,'on');
        ax6.XColor=[0.3 0.3 0.3]; ax6.YColor=[0.3 0.3 0.3];
        ax6.GridColor=[0.88 0.88 0.88]; ax6.GridAlpha=1;
        xlabel(ax6,'Direction (°)','FontSize',8);
        ylabel(ax6,'Count','FontSize',8);
        title(ax6, sprintf('Direction  (pol = %.0f°)', polAng), 'FontSize',8);
        ax6.XLim=[0 180]; ax6.XTick=[0 45 90 135 180];
        if ~isempty(dv_d)
            dir180 = mod(dv_d - polAng, 180);   % range [0, 180)
            edges6 = 0:10:180;
            if useSpeedColor
                gradientBar(ax6, edges6, dir180, sv_d, spdIdx, cmap);
            else
                gradientBar(ax6, edges6, dir180, fr_d, frmIdx, cmap);
            end
            cnts6  = histcounts(dir180, edges6);
            if lockHist && histMaxDir > 0
                ax6.YLim = [0 histMaxDir * 1.15];
            else
                ax6.YLim = [0 max(max(cnts6)*1.15, 1)];
            end
            z   = mean(exp(1i * 2 * deg2rad(dir180)));
            R6  = abs(z);
            mu6 = mod(rad2deg(angle(z) / 2), 180);
            tpSubtitle(ax6, sprintf('mean %.1f°  |  R = %.3f', mu6, R6));
        end

        drawnow;
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Overview — all individuals of a multi-individual file at a glance
    %% ══════════════════════════════════════════════════════════════════════════

    function renderOverview(parent, T, ovNames, st, fname, folder)
        nInd    = numel(ovNames);
        fps     = st.fps;
        pxScale = st.pxScale;
        minSpd  = st.minSpd;
        nFrames = height(T);
        roiCx = 0; roiCy = 0; roiD = 0;
        if isfield(st,'roiCx'), roiCx = st.roiCx; end
        if isfield(st,'roiCy'), roiCy = st.roiCy; end
        if isfield(st,'roiD'),  roiD  = st.roiD;  end
        polAng = 0;
        if isfield(st,'polAng'), polAng = st.polAng; end
        if pxScale == 1
            posUnit = 'px';  spdUnit = 'px/s';
        else
            posUnit = 'cm';  spdUnit = 'cm/s';
        end
        cmapInd = overviewColors(max(nInd,1));

        % Background frame: AnimalTracker writes a clean reference frame to
        % {folder}/../sessions/{stem}_bg.png (sibling of the export folder
        % this CSV lives in) for most files — far more complete coverage
        % than the tracked output videos, and no video decoding needed.
        bgImg = [];
        if nargin >= 6 && ~isempty(folder)
            stem0 = regexprep(fname, '_tracks\.csv$', '');
            bgCand = fullfile(fileparts(folder), 'sessions', [stem0 '_bg.png']);
            if exist(bgCand, 'file')
                try, bgImg = imread(bgCand); catch, bgImg = []; end
            end
        end

        % ── Per-individual positions & stats ────────────────────────────────
        posAll     = cell(nInd,1);
        ovLabel    = cell(nInd,1);
        ovDist     = nan(nInd,1);
        ovMeanSpd  = nan(nInd,1);
        ovMedSpd   = nan(nInd,1);
        ovMu       = nan(nInd,1);
        ovR        = nan(nInd,1);
        for ovI = 1:nInd
            px = T.([ovNames{ovI} '_X']);
            py = T.([ovNames{ovI} '_Y']);
            if isfield(st,'timeCut') && st.timeCut && isfield(st,'timeCutVal') && isfinite(st.timeCutVal)
                cutIdx = floor(st.timeCutVal * fps) + 1;
                if cutIdx >= 1 && cutIdx <= nFrames
                    px(cutIdx:end) = NaN; py(cutIdx:end) = NaN;
                end
            end
            if isfield(st,'roiFilterPct')
                [px, py] = applyROIFilter(px, py, roiCx, roiCy, roiD, st.roiFilterPct);
            end
            posAll{ovI} = [px, py];

            dx = diff(px);  dy = diff(py);
            vp = ~isnan(px(1:end-1)) & ~isnan(px(2:end));
            sv = [];
            if any(vp), sv = sqrt(dx(vp).^2 + dy(vp).^2) * pxScale * fps; end
            dm = sv >= minSpd;

            % Mean axial direction + vector strength (polaroid-corrected,
            % doubled-angle), same convention as renderInto Panel 6 / the
            % stats CSV's mean_dir_deg & vector_R columns.
            mu = NaN;  Rv = NaN;
            if any(vp)
                dv_valid = atan2d(dy(vp), dx(vp));
                dv_d = dv_valid(dm);
                if ~isempty(dv_d)
                    dir180 = mod(dv_d - polAng, 180);
                    z  = mean(exp(1i * 2 * deg2rad(dir180)));
                    Rv = abs(z);
                    mu = mod(rad2deg(angle(z) / 2), 180);
                end
            end

            totalDist = 0;
            if any(vp), totalDist = sum(sqrt(dx(vp).^2 + dy(vp).^2)) * pxScale; end
            meanSpd = NaN;  medSpd = NaN;
            if any(dm), meanSpd = mean(sv(dm));  medSpd = median(sv(dm)); end

            ovLabel{ovI}    = ovNames{ovI};
            ovDist(ovI)     = totalDist;
            ovMeanSpd(ovI)  = meanSpd;
            ovMedSpd(ovI)   = medSpd;
            ovMu(ovI)       = mu;
            ovR(ovI)        = Rv;
        end

        % ── Title ────────────────────────────────────────────────────────────
        axT = axes('Parent',parent,'Position',[0 0.94 1 0.06]); axT.Visible = 'off';
        text(0.02, 0.5, fname, 'Interpreter','none','HorizontalAlignment','left', ...
            'VerticalAlignment','middle','FontSize',10,'FontWeight','bold', ...
            'Color',[0.15 0.15 0.15],'Units','normalized');
        indivWord = 'individuals';  if nInd == 1, indivWord = 'individual'; end
        text(0.98, 0.5, sprintf('Overview — %d %s', nInd, indivWord), ...
            'Interpreter','none','HorizontalAlignment','right', ...
            'VerticalAlignment','middle','FontSize',10,'FontWeight','bold', ...
            'Color',[0.15 0.45 0.75],'Units','normalized');

        % ── Panel A: XY overlay of every individual ─────────────────────────
        axA = axes('Parent',parent,'Position',[0.03 0.06 0.44 0.84]);
        hold(axA,'on'); axA.Color='w'; grid(axA,'on'); box(axA,'on');
        axA.XColor=[0.3 0.3 0.3]; axA.YColor=[0.3 0.3 0.3];
        axA.GridColor=[0.88 0.88 0.88]; axA.GridAlpha=1;
        % Track_X/Y follow video/image pixel convention (row 0 at the top,
        % increasing downward), so this axis uses the matching "ij" sense
        % (YDir reverse) rather than MATLAB's plot default — otherwise tracks
        % plot upside-down relative to the arena. Scoped to this panel only:
        % it's a display-only setting, so it doesn't touch any distance/
        % speed/direction math, and renderInto's track panel is unaffected.
        axA.YDir = 'reverse';
        xlabel(axA,['X (' posUnit ')'],'FontSize',8);
        ylabel(axA,['Y (' posUnit ')'],'FontSize',8);
        title(axA,'All individuals — XY tracks','FontSize',9);

        if ~isempty(bgImg)
            % With YDir reversed to match, the image now takes its plain,
            % un-transposed row order: row 1 (physical top) at y=0.
            imgH = size(bgImg,1);  imgW = size(bgImg,2);
            image(axA, 'XData',[0 imgW]*pxScale, 'YData',[0 imgH]*pxScale, 'CData',bgImg);
            grid(axA,'off');
        end

        legH = gobjects(nInd,1);
        for ovI = 1:nInd
            px = posAll{ovI}(:,1);  py = posAll{ovI}(:,2);
            valid = ~isnan(px);
            if ~any(valid), continue; end
            lh = plot(axA, px(valid)*pxScale, py(valid)*pxScale, '-', ...
                'Color', cmapInd(ovI,:), 'LineWidth', 0.9);
            hsc = scatter(axA, px(valid)*pxScale, py(valid)*pxScale, 7, cmapInd(ovI,:), ...
                'filled', 'MarkerFaceAlpha', 0.45);
            vidx = find(valid);
            hStart = plot(axA, px(vidx(1))*pxScale, py(vidx(1))*pxScale, 'o', 'MarkerSize',6, ...
                'MarkerEdgeColor','k','MarkerFaceColor',cmapInd(ovI,:),'LineWidth',1.0);
            hEnd = plot(axA, px(vidx(end))*pxScale, py(vidx(end))*pxScale, 'x', 'MarkerSize',8, ...
                'MarkerEdgeColor',cmapInd(ovI,:),'LineWidth',1.5);
            legH(ovI) = lh;
            % Clicking the track (line, dots, or start/end markers) jumps to
            % that individual's single-track view.
            clickCB = @(~,~) onOverviewTrackClick(ovNames{ovI});
            set([lh, hsc, hStart, hEnd], 'ButtonDownFcn', clickCB);
        end
        if roiD > 0
            r1  = roiD * pxScale / 2;
            cx1 = roiCx * pxScale;  cy1 = roiCy * pxScale;
            m1  = r1 * 0.15;
            th1 = linspace(0, 2*pi, 120);
            plot(axA, cx1 + r1*cos(th1), cy1 + r1*sin(th1), '-', ...
                'Color',[0.82 0.82 0.82],'LineWidth',1.5);
            axA.XLim = [cx1 - r1 - m1, cx1 + r1 + m1];
            axA.YLim = [cy1 - r1 - m1, cy1 + r1 + m1];
        end
        axis(axA,'equal');
        okLeg = isgraphics(legH);
        if any(okLeg)
            legend(axA, legH(okLeg), strrep(ovLabel(okLeg),'_',' '), ...
                'Location','eastoutside','FontSize',7);
        end
        tpSubtitle(axA, '○ = first valid frame   ✕ = last valid frame');

        % ── Panel C: total distance by individual ───────────────────────────
        axC = axes('Parent',parent,'Position',[0.52 0.08 0.195 0.32]);
        hold(axC,'on'); axC.Color='w'; grid(axC,'on'); box(axC,'on');
        axC.XColor=[0.3 0.3 0.3]; axC.YColor=[0.3 0.3 0.3];
        axC.GridColor=[0.88 0.88 0.88]; axC.GridAlpha=1;
        ylabel(axC, sprintf('Dist (%s)',posUnit), 'FontSize',8);
        title(axC, 'Distance', 'FontSize',8);
        for ovI = 1:nInd
            v = ovDist(ovI);  if isnan(v), v = 0; end
            hbarC = bar(axC, ovI, v, 'FaceColor', cmapInd(ovI,:), 'EdgeColor','none');
            hbarC.ButtonDownFcn = @(~,~) onOverviewTrackClick(ovLabel{ovI});
        end
        axC.XLim = [0.3 nInd+0.7];
        axC.XTick = 1:nInd; axC.XTickLabel = strrep(ovLabel,'_',' ');
        axC.XTickLabelRotation = 45;

        % ── Panel D: mean speed by individual ────────────────────────────────
        axD = axes('Parent',parent,'Position',[0.775 0.08 0.195 0.32]);
        hold(axD,'on'); axD.Color='w'; grid(axD,'on'); box(axD,'on');
        axD.XColor=[0.3 0.3 0.3]; axD.YColor=[0.3 0.3 0.3];
        axD.GridColor=[0.88 0.88 0.88]; axD.GridAlpha=1;
        ylabel(axD, sprintf('Speed (%s)',spdUnit), 'FontSize',8);
        title(axD, 'Speed', 'FontSize',8);
        for ovI = 1:nInd
            v = ovMeanSpd(ovI);  if isnan(v), v = 0; end
            hbarD = bar(axD, ovI, v, 'FaceColor', cmapInd(ovI,:), 'EdgeColor','none');
            hbarD.ButtonDownFcn = @(~,~) onOverviewTrackClick(ovLabel{ovI});
        end
        axD.XLim = [0.3 nInd+0.7];
        axD.XTick = 1:nInd; axD.XTickLabel = strrep(ovLabel,'_',' ');
        axD.XTickLabelRotation = 45;

        % ── Panel E: mean direction × R, polar (axial, mirrored like the
        % cross-file summary figure's polar scatter) — takes the big
        % top-right slot the per-individual text table used to occupy;
        % that table wasn't a useful way to read this data.
        axE = axes('Parent',parent,'Position',[0.52 0.50 0.45 0.42]);
        hold(axE,'on'); axis(axE,'equal'); axis(axE,'off'); axE.Color='w';
        % mu is atan2d(dy,dx) on raw Track_X/Y, i.e. plain math convention —
        % but Panel A displays Y reversed (video convention: down = +Y), so
        % without this, a direction that visually points down in Panel A
        % would plot pointing up here. Reversing Y here too keeps the two
        % panels' sense of "up" consistent (0°/180° stay put on the left-
        % right axis; it's the top/bottom labels that swap).
        axE.YDir = 'reverse';
        title(axE, sprintf('Direction (pol = %.0f°)', polAng), 'FontSize',8);
        th_ring = linspace(0, 2*pi, 120);
        for gr = [0.5 1.0]
            plot(axE, gr*cos(th_ring), gr*sin(th_ring), '-', 'Color',[0.85 0.85 0.85], 'LineWidth',0.5);
        end
        cardThE = [0, pi/2, pi, -pi/2]; cardLblE = {'0°','90°','180°','-90°'};
        for ci = 1:4
            plot(axE, [0 1.05]*cos(cardThE(ci)), [0 1.05]*sin(cardThE(ci)), '-', ...
                'Color',[0.8 0.8 0.8], 'LineWidth',0.5);
            text(axE, 1.18*cos(cardThE(ci)), 1.18*sin(cardThE(ci)), cardLblE{ci}, ...
                'HorizontalAlignment','center','FontSize',6,'Color',[0.4 0.4 0.4]);
        end
        for ovI = 1:nInd
            if isnan(ovMu(ovI)) || isnan(ovR(ovI)), continue; end
            muRad = deg2rad(ovMu(ovI));
            % Axial: a direction and its 180°-flip are statistically the same
            % axis, so both are plotted (matching makeFigure's polar scatter),
            % joined by a line through the origin so each individual's axis
            % reads as a single line rather than two unrelated dots.
            xA = ovR(ovI) * cos(muRad);  yA = ovR(ovI) * sin(muRad);
            hlnE = plot(axE, [xA -xA], [yA -yA], '-', 'Color', cmapInd(ovI,:), 'LineWidth', 1.2);
            hscE = scatter(axE, [xA -xA], [yA -yA], 26, cmapInd(ovI,:), 'filled', 'MarkerFaceAlpha',0.85);
            clickCB = @(~,~) onOverviewTrackClick(ovLabel{ovI});
            set([hlnE, hscE], 'ButtonDownFcn', clickCB);
        end
        axE.XLim = [-1.3 1.3]; axE.YLim = [-1.3 1.3];

        drawnow;
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Session persistence
    %% ══════════════════════════════════════════════════════════════════════════

    function saveState()
        S = getappdata(fig,'S');
        if isempty(S.folder) || isempty(S.files), return; end
        stateFile = fullfile(S.folder, 'TrackPlotter_state.mat');
        files        = S.files;        %#ok<NASGU>
        fileSettings = S.fileSettings; %#ok<NASGU>
        speedPrctile = S.speedPrctile; %#ok<NASGU>
        lockHist     = logical(S.chkHistLock.Value); %#ok<NASGU>
        timeCut      = logical(S.chkTimeCut.Value); %#ok<NASGU>
        timeCutVal   = parseNum(S.edtTimeCut.String, inf, 0, inf); %#ok<NASGU>
        showPolLine  = logical(S.chkPolLine.Value); %#ok<NASGU>
        useColormap  = logical(S.chkColormap.Value); %#ok<NASGU>
        useSpeedColor = logical(S.chkColorSpeed.Value); %#ok<NASGU>
        lockSpeed    = logical(S.chkSpeedLock.Value); %#ok<NASGU>
        roiFilterPct = parseNum(S.edtROIFilterPct.String, 0, 0, 1000); %#ok<NASGU>
        try
            save(stateFile, 'files', 'fileSettings', 'speedPrctile', ...
                'lockHist', 'timeCut', 'timeCutVal', 'showPolLine', ...
                'useColormap', 'useSpeedColor', 'lockSpeed', 'roiFilterPct');
        catch
        end
    end

    function loadState()
        S = getappdata(fig,'S');
        if isempty(S.folder) || isempty(S.files), return; end
        stateFile = fullfile(S.folder, 'TrackPlotter_state.mat');
        if ~exist(stateFile, 'file'), return; end
        try
            saved = load(stateFile, 'files', 'fileSettings', 'speedPrctile', ...
                'lockHist', 'timeCut', 'timeCutVal', 'showPolLine', ...
                'useColormap', 'useSpeedColor', 'lockSpeed', 'roiFilterPct');
        catch
            return;
        end
        % Match saved settings to current file list by filename
        for fi = 1:numel(S.files)
            mi = find(strcmp(saved.files, S.files{fi}), 1);
            if ~isempty(mi) && mi <= numel(saved.fileSettings) ...
                    && ~isempty(saved.fileSettings{mi})
                S.fileSettings{fi} = saved.fileSettings{mi};
            end
        end
        % Restore folder-level display settings
        if isfield(saved,'speedPrctile') && ~isnan(saved.speedPrctile)
            S.speedPrctile = saved.speedPrctile;
            S.edtSpeedPrctile.String = num2str(saved.speedPrctile);
        end
        if isfield(saved,'lockHist')
            S.chkHistLock.Value = double(saved.lockHist);
        end
        if isfield(saved,'timeCut')
            S.chkTimeCut.Value = double(saved.timeCut);
        end
        if isfield(saved,'timeCutVal') && isfinite(saved.timeCutVal)
            S.edtTimeCut.String = num2str(saved.timeCutVal);
        end
        if isfield(saved,'showPolLine')
            S.chkPolLine.Value = double(saved.showPolLine);
        end
        if isfield(saved,'useColormap')
            S.chkColormap.Value = double(saved.useColormap);
        end
        if isfield(saved,'useSpeedColor')
            S.chkColorSpeed.Value = double(saved.useSpeedColor);
        end
        if isfield(saved,'lockSpeed')
            S.chkSpeedLock.Value = double(saved.lockSpeed);
        end
        if isfield(saved,'roiFilterPct') && isfinite(saved.roiFilterPct)
            S.edtROIFilterPct.String = num2str(saved.roiFilterPct);
        end
        setappdata(fig,'S',S);
    end

    function scanFolderSpeedMax()
        % Scans each file's saved/default animalIdx track — the same track
        % that's actually rendered/exported for that file — so this stays
        % consistent with scanFolderHistMax below (previously this scanned
        % every animal column in every file, while the hist scan only used
        % the selected animal, so the two locked axes weren't comparable).
        S = getappdata(fig,'S');
        if isempty(S.files), return; end
        pct = max(1, min(100, S.speedPrctile));
        S.lblStatus.String = sprintf('Scanning speeds (%gth percentile)…', pct);
        setappdata(fig,'S',S);
        drawnow;
        gMax = 0;
        for fi = 1:numel(S.files)
            fpath = fullfile(S.folder, S.files{fi});
            try, T = getTable(fpath); catch, continue; end
            fst = defSt();
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi})
                fst = S.fileSettings{fi};
            end
            names = findAnimalColumns(T);
            if isempty(names), continue; end
            nm = names{min(fst.animalIdx, numel(names))};
            px = T.([nm '_X']);  py = T.([nm '_Y']);
            if S.chkTimeCut.Value
                cutVal = parseNum(S.edtTimeCut.String, inf, 0, inf);
                if isfinite(cutVal)
                    ci = floor(cutVal * fst.fps) + 1;
                    if ci <= numel(px), px(ci:end) = NaN; py(ci:end) = NaN; end
                end
            end
            [px, py] = applyROIFilter(px, py, fst.roiCx, fst.roiCy, fst.roiD, ...
                parseNum(S.edtROIFilterPct.String, 0, 0, 1000));
            dx = diff(px);  dy = diff(py);
            vp = ~isnan(px(1:end-1)) & ~isnan(px(2:end));
            if ~any(vp), continue; end
            spd = sqrt(dx(vp).^2 + dy(vp).^2) * fst.pxScale * fst.fps;
            if ~isempty(spd)
                gMax = max(gMax, prctile(spd, pct));
            end
        end
        S = getappdata(fig,'S');
        S.globalSpeedMax = gMax;
        setappdata(fig,'S',S);
    end

    function scanFolderHistMax()
        S = getappdata(fig,'S');
        if isempty(S.files), return; end
        S.lblStatus.String = 'Scanning histogram counts…';
        setappdata(fig,'S',S); drawnow;
        hiSpd = max(S.globalSpeedMax * 1.001, 0.1);
        edges4 = linspace(0, hiSpd, 21);
        edges6 = 0:10:180;
        maxSpdCnt = 0;  maxDirCnt = 0;
        for fi = 1:numel(S.files)
            fpath = fullfile(S.folder, S.files{fi});
            try, T = getTable(fpath); catch, continue; end
            fst = defSt();
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi})
                fst = S.fileSettings{fi};
            end
            names = findAnimalColumns(T);
            if isempty(names), continue; end
            nm = names{min(fst.animalIdx, numel(names))};
            px = T.([nm '_X']);  py = T.([nm '_Y']);
            if S.chkTimeCut.Value
                cutVal = parseNum(S.edtTimeCut.String, inf, 0, inf);
                if isfinite(cutVal)
                    ci = floor(cutVal * fst.fps) + 1;
                    if ci <= numel(px), px(ci:end) = NaN; py(ci:end) = NaN; end
                end
            end
            [px, py] = applyROIFilter(px, py, fst.roiCx, fst.roiCy, fst.roiD, ...
                parseNum(S.edtROIFilterPct.String, 0, 0, 1000));
            dx = diff(px);  dy = diff(py);
            vp = ~isnan(px(1:end-1)) & ~isnan(px(2:end));
            if ~any(vp), continue; end
            spd   = sqrt(dx(vp).^2 + dy(vp).^2) * fst.pxScale * fst.fps;
            dir_v = atan2d(dy(vp), dx(vp));
            dm    = spd >= fst.minSpd;
            if any(dm)
                cnts = histcounts(spd(dm), edges4);
                maxSpdCnt = max(maxSpdCnt, max(cnts));
                dir180 = mod(dir_v(dm) - fst.polAng, 180);
                cnts = histcounts(dir180, edges6);
                maxDirCnt = max(maxDirCnt, max(cnts));
            end
        end
        S = getappdata(fig,'S');
        S.globalHistMaxSpd = maxSpdCnt;
        S.globalHistMaxDir = maxDirCnt;
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Help popup
    %% ══════════════════════════════════════════════════════════════════════════

    function showHelp()
        helpTxt = {
'TRACK PLOTTER — How calculations work'
'══════════════════════════════════════════════════════════'
''
'INPUT DATA'
'  CSV files with columns {Label}_X and {Label}_Y (pixel'
'  coordinates, one row per frame). A file with several such'
'  pairs (e.g. Track1_X/Y, Track2_X/Y, ...) holds several'
'  individuals tracked in the same experiment. Optional'
'  ROI_cx/ROI_cy/ROI_diam columns auto-fill the arena circle.'
''
'MULTI-INDIVIDUAL FILES — OVERVIEW'
'  Files with more than one individual get an extra'
'  "— Overview (ALL individuals) —" entry at the top of the'
'  Animal dropdown (selected by default the first time you'
'  open such a file). It shows every individual''s XY track'
'  overlaid with a legend, a per-individual stats table'
'  (coverage %, distance, speed, straightness), and bar charts'
'  comparing distance and speed across individuals — a quick'
'  way to spot incomplete or outlier tracks before picking one'
'  from the dropdown to analyze in full. Batch save and the'
'  export (💾) button also save this overview alongside the'
'  per-individual figure. Export CSV writes one row per'
'  individual (not just the one currently selected). If the'
'  folder has a sibling "sessions" directory with a matching'
'  {file}_bg.png (AnimalTracker''s clean reference frame), the'
'  XY-track panel draws it behind the tracks for arena context;'
'  missing for a file, the panel just falls back to a plain plot.'
''
'TRACK SETTINGS (per file)'
'  FPS          Frame rate of the recording. Used to convert'
'               per-frame distances to per-second speeds.'
''
'  Scale (cm/px) Multiply pixel distances by this to get cm.'
'               Set to 1 to work in raw pixels.'
''
'  Min speed    Speed threshold (same units as speed axis).'
'               Points below this are shown faded in panels'
'               4 & 5 and excluded from all direction stats.'
''
'  Pol. angle   Degrees to subtract from all bearings so that'
'               0° aligns with the polaroid orientation.'
''
'  ROI center / ROI diameter'
'               Pixel coordinates and diameter of the arena'
'               circle. When set, Panel 1 zooms to the ROI.'
''
'SPEED CALCULATION'
'  speed = sqrt(dx² + dy²) × scale × fps'
'  where dx, dy are the per-frame pixel displacements.'
'  Units: cm/s when scale ≠ 1, px/s otherwise.'
'  NaN frames (dropped detections) are excluded from'
'  the preceding and following displacement.'
''
'DIRECTION (BEARING) CALCULATION'
'  bearing = atan2(dy, dx) in degrees (0° = East).'
'  Polaroid correction: bearing − pol. angle.'
'  Panel 6 (bottom-right) wraps bearings to −90°…+90°'
'  so that 0° sits at the histogram centre and represents'
'  movement aligned with the polaroid.'
''
'PANELS'
'  1 — XY track, coloured by time (parula: blue→yellow).'
'      Faint dots show the full unfiltered path.'
'      Subtitle reports tortuosity metrics:'
'        SI (straightness index) = net displacement / path'
'          length. Range 0–1; 1 = perfectly straight line.'
'        turn = mean absolute turning angle (°) between'
'          consecutive above-min-speed steps. Low = directionally'
'          persistent; high = frequently turning.'
'        disp = net displacement, straight-line start-to-end.'
''
'  2 — Bearing (left axis, °) and raw speed (right axis)'
'      vs time, coloured by time.'
''
'  3 — Speed histogram (20 bins). Bars coloured by time'
'      (or speed when Color: speed is on).'
'      Subtitle reports median speed, total path length, and'
'      CV (coefficient of variation = std/mean of above-min-'
'      speed frame speeds). CV≈0 means steady pace; high CV'
'      means the animal alternated between bursts and stops.'
''
'  4 — Direction rose. Each wedge spans 15°. Wedge colour'
'      reflects mean frame time (or mean speed) in that bin.'
'      Orange overlay = polaroid-corrected bearings.'
''
'  5 — Speed vs direction scatter. Faded points are below'
'      the min-speed cutoff. Dashed line = cutoff.'
''
'  6 — Axial direction histogram (0° to 180°, 10° bins).'
'      0°/180° = polaroid direction, 90° = perpendicular.'
'      Mean direction µ and vector strength R are computed'
'      using the axial (180°) circular statistics:'
''
'      Why double the angles?'
'      Bearings like +45° and −135° are physically the same'
'      axis of movement (the animal just went the other way).'
'      Doubling maps both to +90°, so the circular mean'
'      treats them as equivalent. The result is then halved'
'      back to recover the original axis.'
''
'      Code (renderInto, panel 6 bottom-right / exportCSV):'
'        z   = mean(exp(1i * 2 * deg2rad(dir180)))'
'        R   = abs(z)'
'        µ   = angle(z) / 2   [radians, then converted to °]'
''
'      exp(i·2θ) maps each bearing to a unit vector on the'
'      complex circle at twice the angle. mean(...) gives'
'      the mean resultant vector. abs() is its length = R.'
'        R = 0 → bearings are uniformly distributed'
'        R = 1 → all bearings identical (perfect alignment)'
''
'DISPLAY SETTINGS (folder-level)'
'  Lock speed axis  When on, all files share the same speed'
'                   axis limit, set to the Nth-percentile of'
'                   the per-frame speeds across the whole'
'                   folder. Allows direct comparison.'
''
'  Lock hist. Y axis  When on, all speed and direction'
'                   histograms share the same Y-axis limit'
'                   (folder-wide maximum bin count).'
''
'  Max ROI%         Omits any track point farther than this'
'                   percent of the ROI radius from the ROI'
'                   center — e.g. 110 keeps a 10% margin beyond'
'                   the nominal arena edge, 90 is stricter than'
'                   the nominal edge. 0 (default) turns this off.'
'                   Applies to every file using its own ROI,'
'                   same as a time cutoff: omitted points become'
'                   NaN before any distance/speed/direction stat'
'                   is computed, in every view and export.'
''
'  Color: time      Parula gradient encoding elapsed time for all'
'                   coloured elements (off = uniform grey).'
'  Color: speed     Parula gradient encoding speed instead of time,'
'                   spread by the speed distribution (CDF-equalised)'
'                   so colours track where the speeds actually fall.'
'                   Mutually exclusive with Color: time.'
''
'EXPORT STATS CSV'
'  Computes summary statistics for every individual in every'
'  file in the folder (using each file''s saved Track settings,'
'  applied the same way to all its individuals), then writes a'
'  single CSV with one row per individual — several rows for a'
'  multi-individual file, naturally one row for a single-'
'  individual file. Columns:'
'    file, wavelength_nm, condition, individual, trial, animal,'
'    fps, scale_cm_per_px, pol_angle_deg, min_speed,'
'    n_frames_valid, n_frames_above_min, total_dist,'
'    mean_speed, median_speed, mean_dir_deg (µ), vector_R (R),'
'    net_disp, straightness_index, mean_abs_turn_deg, cv_speed,'
'    run_straightness, median_run_len, n_runs.'
'  run_straightness = straightness (chord/path) measured only'
'    within straight runs, segmented at >110° heading changes'
'    and pauses, then path-length-weighted. Unlike'
'    straightness_index this is not collapsed by wall bounces.'
'  median_run_len = typical straight-run length before a turn.'
'  n_runs = number of straight runs detected.'
'  wavelength_nm, condition (pol/dif), trial, and individual are'
'  parsed automatically from the filename pattern:'
'  {wl}_{pol|dif}_{angle}_t{trial}_i{individual}_tracks.csv'
        };

        % Reuse existing window if open
        existing = findobj('Type','figure','Name','TrackPlotter Help');
        if ~isempty(existing), figure(existing(1)); return; end

        hHelp = figure('Name','TrackPlotter Help','NumberTitle','off', ...
            'Color','w','MenuBar','none','ToolBar','none', ...
            'Units','pixels','Position',[200 100 520 680], ...
            'Resize','on');
        txt = uicontrol(hHelp,'Style','edit', ...
            'Units','normalized','Position',[0.02 0.02 0.96 0.96], ...
            'String', helpTxt, ...
            'Max',2,'Enable','inactive', ...
            'HorizontalAlignment','left', ...
            'FontName','Courier New','FontSize',9, ...
            'BackgroundColor','w','ForegroundColor',[0.10 0.10 0.10]);
        txt.Units = 'normalized';
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Export stats CSV
    %% ══════════════════════════════════════════════════════════════════════════

    function exportCSV()
        S = getappdata(fig,'S');
        if isempty(S.files)
            S.lblStatus.String = 'No files loaded.'; setappdata(fig,'S',S); return;
        end
        saveCurrentSettings();
        S = getappdata(fig,'S');

        [~, dname] = fileparts(S.folder);
        defaultName = fullfile(S.folder, [dname '_trackstats.csv']);
        [fn, fp] = uiputfile('*.csv', 'Save stats CSV', defaultName);
        if isequal(fn,0), return; end
        outPath = fullfile(fp, fn);

        S.lblStatus.String = 'Computing stats…';
        setappdata(fig,'S',S); drawnow;

        % Determine speed/distance units: cm if ANY configured file uses a
        % pixel scale, otherwise px. (Previously this checked file 1 only,
        % due to an unconditional break, so a folder mixing default/cm-scaled
        % files could get every column header mislabeled.)
        posUnit = 'px';  spdUnit = 'px/s';
        for fi = 1:numel(S.files)
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi}) ...
                    && S.fileSettings{fi}.pxScale ~= 1
                posUnit = 'cm';  spdUnit = 'cm/s';
                break;
            end
        end

        hdrs = {'file', 'wavelength_nm', 'condition', 'individual', 'trial', ...
                'animal', 'fps', 'scale_cm_per_px', 'pol_angle_deg', ...
                'min_speed', 'n_frames_valid', 'n_frames_above_min', ...
                ['total_dist_' posUnit], ['mean_speed_' spdUnit], ...
                ['median_speed_' spdUnit], 'mean_dir_deg', 'vector_R', ...
                ['net_disp_' posUnit], 'straightness_index', ...
                'mean_abs_turn_deg', 'cv_speed', ...
                'run_straightness', ['median_run_len_' posUnit], 'n_runs'};
        rows = {};

        for fi = 1:numel(S.files)
            fpath = fullfile(S.folder, S.files{fi});
            try, T = getTable(fpath); catch, continue; end
            fst = defSt();
            if fi <= numel(S.fileSettings) && ~isempty(S.fileSettings{fi})
                fst = S.fileSettings{fi};
            end

            aCols = findAnimalColumns(T);
            if isempty(aCols), continue; end

            % Parse wavelength, condition, pol_angle, trial, individual from filename
            % (legacy {wl}_{pol|dif}_{angle}_t{trial}_i{individual} naming —
            % NaN/blank for other datasets, e.g. this one's date_videocode names)
            tok = regexp(S.files{fi}, '^(\d+)_(pol|dif)_(\d+)_t(\d+)_i(\d+)', 'tokens', 'once');
            if ~isempty(tok)
                wl    = str2double(tok{1});  cond  = tok{2};
                trial = str2double(tok{4});  indiv = str2double(tok{5});
                fst.polAng = str2double(tok{3});
            else
                wl = NaN;  cond = '';  trial = NaN;  indiv = NaN;
            end

        % One row per individual (TrackN) found in the file — a single-
        % individual legacy file just has one aCols entry, so this loop
        % reduces to the old one-row-per-file behaviour for those.
        for ti = 1:numel(aCols)
            nm = aCols{ti};

            posX = T.([nm '_X']);  posY = T.([nm '_Y']);
            if S.chkTimeCut.Value
                cutVal = parseNum(S.edtTimeCut.String, inf, 0, inf);
                if isfinite(cutVal)
                    ci = floor(cutVal * fst.fps) + 1;
                    if ci <= numel(posX), posX(ci:end) = NaN; posY(ci:end) = NaN; end
                end
            end
            [posX, posY] = applyROIFilter(posX, posY, fst.roiCx, fst.roiCy, fst.roiD, ...
                parseNum(S.edtROIFilterPct.String, 0, 0, 1000));
            dx = diff(posX);       dy   = diff(posY);
            spd_v = sqrt(dx.^2 + dy.^2);
            dir_v = atan2d(dy, dx);
            vp    = ~isnan(posX(1:end-1)) & ~isnan(posX(2:end));

            if ~any(vp)
                rows{end+1} = {S.files{fi}, wl, cond, indiv, trial, nm, fst.fps, fst.pxScale, ...
                    fst.polAng, fst.minSpd, 0, 0, NaN, NaN, NaN, NaN, NaN, NaN, NaN, ...
                    NaN, NaN, NaN, NaN, 0}; %#ok<AGROW>
                continue;
            end

            sv_raw    = spd_v(vp) * fst.pxScale * fst.fps;
            dv        = dir_v(vp);
            totalDist = sum(spd_v(vp)) * fst.pxScale;
            nValid    = sum(vp);

            dm    = sv_raw >= fst.minSpd;
            sv_d  = sv_raw(dm);
            dv_d  = dv(dm);
            nAbove = sum(dm);

            mspd  = NaN;  mdspd = NaN;
            if ~isempty(sv_d), mspd = mean(sv_d);  mdspd = median(sv_d); end

            mu6 = NaN;  R6 = NaN;
            if ~isempty(dv_d)
                dir180 = mod(dv_d - fst.polAng, 180);
                z   = mean(exp(1i * 2 * deg2rad(dir180)));
                R6  = abs(z);
                mu6 = mod(rad2deg(angle(z) / 2), 180);
            end

            % Tortuosity and variability
            netDisp = NaN;  SI = NaN;  meanAbsTurn = NaN;  cvSpd = NaN;
            vld = find(~isnan(posX));
            if numel(vld) >= 2
                netDisp = sqrt((posX(vld(end))-posX(vld(1)))^2 + ...
                               (posY(vld(end))-posY(vld(1)))^2) * fst.pxScale;
                if totalDist > 1e-9, SI = netDisp / totalDist; end
            end
            if numel(dv_d) >= 2
                td = mod(diff(dv_d) + 180, 360) - 180;
                meanAbsTurn = mean(abs(td));
            end
            if numel(sv_d) >= 2, cvSpd = std(sv_d) / mean(sv_d); end

            % Run-based straightness: straightness within straight stretches,
            % segmented at sharp turns / pauses (robust to arena wall bounces).
            [siRun, runLen, nRuns] = runStraightness(posX, posY, ...
                fst.pxScale, fst.fps, fst.minSpd);

            rows{end+1} = {S.files{fi}, wl, cond, indiv, trial, nm, fst.fps, fst.pxScale, ...
                fst.polAng, fst.minSpd, nValid, nAbove, totalDist, mspd, mdspd, ...
                mu6, R6, netDisp, SI, meanAbsTurn, cvSpd, ...
                siRun, runLen, nRuns}; %#ok<AGROW>
        end % ti (individual)
        end

        if isempty(rows)
            S.lblStatus.String = 'No data found.'; setappdata(fig,'S',S); return;
        end

        out = cell2table(vertcat(rows{:}), 'VariableNames', hdrs);
        try
            writetable(out, outPath);
            S.lastStatsCSV = outPath;          % remember for the Figure button
            S.btnFigure.Enable = 'on';
            S.lblStatus.String = sprintf('Exported %d rows → %s', height(out), fn);
        catch ME
            S.lblStatus.String = ['Export error: ' ME.message];
        end
        setappdata(fig,'S',S);
    end

    %% ══════════════════════════════════════════════════════════════════════════
    %  Helpers
    %% ══════════════════════════════════════════════════════════════════════════

    function T = getTable(fpath)
    % Read a CSV once per folder session. containers.Map is a handle object,
    % so writes to S.tableCache are visible to every other function through
    % their own getappdata(fig,'S') copy without needing a setappdata here —
    % this avoids re-reading every file from disk on each folder-wide scan
    % (speed-max scan, hist-max scan, batch save, CSV export all hit this).
        S = getappdata(fig,'S');
        if isKey(S.tableCache, fpath)
            T = S.tableCache(fpath);
        else
            T = readtable(fpath);
            S.tableCache(fpath) = T;
        end
    end

    function names = findAnimalColumns(T)
    % {Label}_X / {Label}_Y column pairs in a tracks table, in column order.
        cols  = T.Properties.VariableNames;
        xCols = cols(endsWith(cols, '_X'));
        names = {};
        for ki = 1:numel(xCols)
            lbl = xCols{ki}(1:end-2);
            if ismember([lbl '_Y'], cols), names{end+1} = lbl; end %#ok<AGROW>
        end
    end

    % ── Overview-selection helpers ──────────────────────────────────────────
    % Every file gets an extra "Overview" entry prepended to the Animal
    % popup (position 1), single-individual files included — it defaults to
    % overview on first open, same as multi-individual files, and only
    % switches to the per-track view once a track is explicitly picked.
    % These three helpers are the only place that needs to know about the
    % +1 index offset this introduces.
    function tf = hasOverviewOption(names)
        tf = ~isempty(names);
    end

    function idx = animalIndexFromPopupValue(val, names)
        if hasOverviewOption(names), idx = val - 1; else, idx = val; end
        idx = max(1, min(idx, max(numel(names),1)));
    end

    function val = popupValueFromAnimalIndex(idx, names)
        if hasOverviewOption(names), val = idx + 1; else, val = idx; end
    end

    function tf = isOverviewSelected(S)
        tf = hasOverviewOption(S.animalNames) && S.popAnimal.Value == 1;
    end

    function v = parseNum(str, def, lo, hi)
        v = str2double(str);
        if isnan(v), v = def; end
        v = max(lo, min(hi, v));
    end

    function step = niceStep(range, ~)
        raw  = range / 5;
        mag  = 10^floor(log10(max(raw, 1e-9)));
        step = mag * ceil(raw / mag);
        if step == 0, step = 1; end
    end

    function cmap = overviewColors(n)
    % A per-individual qualitative palette for the Overview. lines(n) only
    % has 7 unique colors and silently repeats them beyond that (file with
    % 8+ tracked individuals would show track 8 in the same color as
    % track 1) — 'gem12' gives 12 distinct colors instead, covering every
    % file in practice (this dataset tops out at 10 individuals), and its
    % first 7 match lines() exactly so files with ≤7 individuals look the
    % same as before.
        try
            base = orderedcolors('gem12');
        catch
            base = lines(7);   % older MATLAB without orderedcolors()
        end
        if n <= size(base,1)
            cmap = base(1:n,:);
        else
            cmap = [base; turbo(n - size(base,1))];
        end
    end

    function [px, py] = applyROIFilter(px, py, roiCx, roiCy, roiD, pct)
    % Treats any point farther than pct% of the ROI radius from its center
    % as a tracking error (e.g. bleeding onto the dish rim/background) and
    % drops it to NaN, same as a timeCut truncation. pct<=0 (the default)
    % or no ROI set leaves the data untouched.
        if ~(isfinite(pct) && pct > 0) || ~(isfinite(roiD) && roiD > 0)
            return;
        end
        radius  = (roiD / 2) * (pct / 100);
        outside = sqrt((px - roiCx).^2 + (py - roiCy).^2) > radius;
        px(outside) = NaN;
        py(outside) = NaN;
    end

    function st = defSt()
        st = struct('fps',10,'pxScale',1,'minSpd',0,'polAng',0, ...
                    'roiCx',0,'roiCy',0,'roiD',0,'animalIdx',1,'viewOverview',true);
    end

    function [a, b] = parseCoordPair(str)
        tok = regexp(str, '-?[\d.]+', 'match');
        if numel(tok) >= 2
            a = str2double(tok{1});  b = str2double(tok{2});
        else
            a = 0;  b = 0;
        end
        if isnan(a), a = 0; end
        if isnan(b), b = 0; end
    end

    function tpSubtitle(ax, str)
        % subtitle() requires R2022a+; fall back to second title line
        try
            subtitle(ax, str, 'FontSize', 7);
        catch
            t = ax.Title;
            t.String = {t.String; str};
            t.FontSize = 7;
        end
    end


    % Stacked histogram bars whose internal bands are coloured by a per-
    % observation quantity (cval — frame time or speed).  idxFn maps a cval to
    % a colormap row, so the same routine serves both colour modes.
    function gradientBar(ax, eEdges, vals, cval, idxFn, cm)
        nBands = 12;
        for bi = 1:numel(eEdges)-1
            if bi < numel(eEdges)-1
                inBin = vals >= eEdges(bi) & vals < eEdges(bi+1);
            else
                inBin = vals >= eEdges(bi) & vals <= eEdges(bi+1);
            end
            cb = sort(cval(inBin));
            n = numel(cb);
            if n == 0, continue; end
            k    = min(n, nBands);
            gBnd = round(linspace(0, n, k+1));
            xlo  = eEdges(bi);  xhi = eEdges(bi+1);
            for gi = 1:k
                idxR = (gBnd(gi)+1):gBnd(gi+1);
                if isempty(idxR), continue; end
                c  = cm(idxFn(mean(cb(idxR))),:);
                ylo = (gi-1)/k * n;  yhi = gi/k * n;
                patch(ax, [xlo xhi xhi xlo], [ylo ylo yhi yhi], c, ...
                    'EdgeColor','none','FaceAlpha',0.85);
            end
            % Bar outline
            plot(ax, [xlo xhi xhi xlo xlo], [0 0 n n 0], 'k-', 'LineWidth',0.5);
        end
    end

    function [siRun, runLen, nRuns] = runStraightness(posX, posY, pxScale, fps, minSpd)
    % Straightness within straight runs, segmented at sharp turns and pauses.
    % A "run" is a contiguous stretch of moving steps (speed >= minSpd) over
    % which the heading change across a short window stays below TURN_THRESH.
    % This isolates the straight stretches between wall turns, so an animal that
    % walks straight, bounces off the arena wall and returns is scored as
    % straight — unlike the whole-track straightness_index (net/total) which
    % such bounces drive toward 0.
    %   siRun  : path-length-weighted mean of chord/arclength across runs (0–1)
    %   runLen : median run path length (units of pxScale .* position)
    %   nRuns  : number of qualifying runs
        TURN_WIN    = 3;     % frames each side of the heading-change window (~1 s)
        TURN_THRESH = 110;   % deg; a larger heading change ends the current run
        SMOOTH_WIN  = 5;     % position smoothing window (frames)
        MIN_RUN_VTX = 3;     % minimum vertices for a run to count

        siRun = NaN;  runLen = NaN;  nRuns = 0;
        valid = ~isnan(posX) & ~isnan(posY);
        x = posX(valid);  y = posY(valid);
        if numel(x) < 10, return; end

        if numel(x) >= SMOOTH_WIN
            x = movmean(x, SMOOTH_WIN);  y = movmean(y, SMOOTH_WIN);
        end
        dx = diff(x);  dy = diff(y);
        step = hypot(dx, dy);            % px per frame
        spd  = step * pxScale * fps;     % cm/s (matches min-speed units)
        head = atan2d(dy, dx);
        n    = numel(head);              % one entry per step (vertices = n+1)

        % Heading change across a +/- TURN_WIN window (NaN at the ends)
        hc = nan(n,1);
        for i = (1+TURN_WIN):(n-TURN_WIN)
            hc(i) = abs(mod(head(i+TURN_WIN) - head(i-TURN_WIN) + 180, 360) - 180);
        end
        brk = (hc > TURN_THRESH) | (spd(:) < minSpd);   % NaN>thresh -> false

        % Segment into maximal runs of consecutive non-break steps
        siList = [];  lenList = [];
        a = 1;
        while a <= n
            if brk(a), a = a + 1; continue; end
            b = a;
            while b < n && ~brk(b+1), b = b + 1; end
            nVtx = (b - a + 1) + 1;                     % steps a..b -> vertices a..b+1
            if nVtx >= MIN_RUN_VTX
                pathLen = sum(step(a:b)) * pxScale;
                chord   = hypot(x(b+1)-x(a), y(b+1)-y(a)) * pxScale;
                if pathLen > 1e-9
                    siList(end+1)  = chord / pathLen;  %#ok<AGROW>
                    lenList(end+1) = pathLen;          %#ok<AGROW>
                end
            end
            a = b + 1;
        end

        if ~isempty(siList)
            w      = lenList(:);
            siRun  = sum(siList(:) .* w) / sum(w);      % path-weighted mean
            runLen = median(lenList);
            nRuns  = numel(siList);
        end
    end

    function makeFigure()
    % Build the behaviour summary figure from the last exported stats CSV:
    %   row 1   polar scatter (mean direction × R per individual)
    %   row 2   mean orientation arrows (axial circular mean)
    %   then one 2-row dif-vs-pol box/slope band per metric, per wavelength:
    %   Vector R, Run straightness, and Mean speed (if the column is present).
        S = getappdata(fig,'S');
        if ~isfield(S,'lastStatsCSV') || isempty(S.lastStatsCSV) || ~exist(S.lastStatsCSV,'file')
            S.lblStatus.String = 'No exported CSV to plot — export the stats CSV first.';
            setappdata(fig,'S',S); return;
        end
        T = readtable(S.lastStatsCSV);
        need = {'wavelength_nm','condition','individual','mean_dir_deg','vector_R','run_straightness'};
        if ~all(ismember(need, T.Properties.VariableNames))
            S.lblStatus.String = 'CSV missing required columns — re-export with this version.';
            setappdata(fig,'S',S); return;
        end
        wls = unique(T.wavelength_nm(~isnan(T.wavelength_nm)))';
        if isempty(wls)
            S.lblStatus.String = 'No wavelength data to plot.';
            setappdata(fig,'S',S); return;
        end
        nWl = numel(wls);
        conds = {'dif','pol'};
        conds = conds(cellfun(@(c) any(strcmp(T.condition,c)), conds));

        % Palette colours: vivid swatch = pol, paired muted swatch = dif.
        wlColors  = zeros(nWl,3);   % pol / vivid
        difColors = zeros(nWl,3);   % dif / muted (paired pastel)
        for i = 1:nWl
            [wlColors(i,:), difColors(i,:)] = tpWlColor(wls(i));
        end

        % Box/slope metric bands, top→bottom: Vector R, Mean speed (if present),
        % Run straightness (bottom, autoscaled to its data range).
        metrics   = {'vector_R'};
        metricLbl = {'Vector R (orientedness)'};
        metricLo  = 0;   metricHi = 1;
        vn  = T.Properties.VariableNames;
        spc = vn(startsWith(vn,'mean_speed'));     % sanitised name, e.g. mean_speed_cm_s
        if ~isempty(spc)
            if     contains(spc{1},'cm'), u = 'cm/s';
            elseif contains(spc{1},'px'), u = 'px/s';
            else,                         u = '';     end
            metrics{end+1}   = spc{1};
            metricLbl{end+1} = ['Mean speed (' u ')'];
            sv = T.(spc{1});  sv = sv(~isnan(sv));
            metricLo(end+1)  = 0;
            metricHi(end+1)  = max([0.1; sv(:)]) * 1.1;   % headroom above the data
        end
        % Run straightness last (bottom), with axes rescaled to the data
        metrics{end+1}   = 'run_straightness';
        metricLbl{end+1} = 'Run straightness';
        rv = T.run_straightness;  rv = rv(~isnan(rv));
        if isempty(rv)
            metricLo(end+1) = 0;  metricHi(end+1) = 1;
        else
            lo = max(0, min(rv) - 0.05);  hi = min(1, max(rv) + 0.03);
            if hi <= lo, lo = 0; hi = 1; end
            metricLo(end+1) = lo;  metricHi(end+1) = hi;
        end
        nMet = numel(metrics);

        figW  = max(680, 200*nWl);
        nRows = 2 + 2*nMet;                 % 2 polar rows + 2 rows per metric band
        figH  = round(figW/nWl * nRows);    % keep tiles ~square so polar plots fit
        f  = figure('Color','w','Position',[60 20 figW figH], ...
            'Name','TrackPlotter — behaviour summary');
        tl = tiledlayout(f, nRows, nWl, 'TileSpacing','tight','Padding','compact');
        th_ring = linspace(0, 2*pi, 300);

        % ── Row 1: polar scatter ──────────────────────────────────────────
        for wi = 1:nWl
            nexttile(tl, wi); hold on; tpPolarGuides(th_ring);
            for ci = 1:numel(conds)
                isPol = strcmp(conds{ci},'pol');
                col   = difColors(wi,:)*(~isPol) + wlColors(wi,:)*(isPol);
                mask  = T.wavelength_nm==wls(wi) & strcmp(T.condition,conds{ci});
                dirs  = deg2rad(T.mean_dir_deg(mask));  Rs = T.vector_R(mask);
                fAll  = tpFileCol(T);  fmask = fAll(mask);
                ok = ~isnan(dirs) & ~isnan(Rs);  dirs = dirs(ok);  Rs = Rs(ok);  fmask = fmask(ok);
                x = [Rs.*cos(dirs); Rs.*cos(dirs+pi)];
                y = [Rs.*sin(dirs); Rs.*sin(dirs+pi)];
                if ~isempty(x)
                    hsc = scatter(x, y, 28, repmat(col,numel(x),1), 'filled','MarkerFaceAlpha',0.80);
                    tpScatterFileTip(hsc, [fmask; fmask]);   % axial mirror → duplicate names
                end
            end
            axis equal; axis([-1.02 1.02 -1.02 1.02]); set(gca,'Visible','off');
        end

        % ── Row 2: mean orientation arrows (axial circular mean) ───────────
        for wi = 1:nWl
            nexttile(tl, nWl+wi); hold on; tpPolarGuides(th_ring);
            for ci = 1:numel(conds)
                isPol = strcmp(conds{ci},'pol');
                mask  = T.wavelength_nm==wls(wi) & strcmp(T.condition,conds{ci});
                dirs  = deg2rad(T.mean_dir_deg(mask));  Rs = T.vector_R(mask);
                ok = ~isnan(dirs) & ~isnan(Rs);  dirs = dirs(ok);  Rs = Rs(ok);
                if isempty(dirs), continue; end
                Cc = mean(Rs.*cos(2*dirs));  Ss = mean(Rs.*sin(2*dirs));
                mAng = atan2(Ss,Cc)/2;  mR = hypot(Cc,Ss);
                ax_ = mR*cos(mAng);  ay_ = mR*sin(mAng);
                acol = wlColors(wi,:);  if ~isPol, acol = min(difColors(wi,:)*0.70,1); end
                quiver(0,0, ax_, ay_,0,'Color',acol,'LineWidth',2.4,'MaxHeadSize',0.9,'AutoScale','off');
                quiver(0,0,-ax_,-ay_,0,'Color',acol,'LineWidth',2.4,'MaxHeadSize',0.9,'AutoScale','off');
            end
            axis equal; axis([-1.02 1.02 -1.02 1.02]); set(gca,'Visible','off');
        end

        % ── Rows 3+: paired box/slope, one metric per 2-row band ───────────
        axB   = gobjects(nMet, nWl);
        boxHW = 0.38/2; dotGap = 0.08;
        xDifDot = 1 + boxHW + dotGap;  xPolDot = 2 - boxHW - dotGap;
        for mi = 1:nMet
            val = metrics{mi};  isBottom = (mi==nMet);  rowBase = (2 + 2*(mi-1))*nWl;
            for wi = 1:nWl
                axB(mi,wi) = nexttile(tl, rowBase+wi, [2 1]); hold on;
                dif_T = T(T.wavelength_nm==wls(wi) & strcmp(T.condition,'dif'), :);
                pol_T = T(T.wavelength_nm==wls(wi) & strcmp(T.condition,'pol'), :);
                [~, id, ip] = intersect(dif_T.individual, pol_T.individual);
                lineCol = [wlColors(wi,:) 0.25];
                for kk = 1:numel(id)
                    plot([xDifDot xPolDot], [dif_T.(val)(id(kk)), pol_T.(val)(ip(kk))], ...
                        '-','Color',lineCol,'LineWidth',1.0);
                end
                if ~isempty(dif_T)
                    bcd = boxchart(ones(height(dif_T),1), dif_T.(val), ...
                        'BoxWidth',0.38,'MarkerStyle','none','LineWidth',1.1);
                    bcd.BoxFaceColor=difColors(wi,:); bcd.WhiskerLineColor=difColors(wi,:);
                    bcd.BoxEdgeColor=difColors(wi,:)*0.75;
                    hsd = scatter(xDifDot*ones(height(dif_T),1), dif_T.(val), 28, difColors(wi,:), ...
                        'filled','MarkerFaceAlpha',0.85);
                    tpScatterFileTip(hsd, tpFileCol(dif_T));
                end
                if ~isempty(pol_T)
                    bcp = boxchart(2*ones(height(pol_T),1), pol_T.(val), ...
                        'BoxWidth',0.38,'MarkerStyle','none','LineWidth',1.1);
                    bcp.BoxFaceColor=wlColors(wi,:); bcp.WhiskerLineColor=wlColors(wi,:);
                    bcp.BoxEdgeColor=wlColors(wi,:)*0.75;
                    hsp = scatter(xPolDot*ones(height(pol_T),1), pol_T.(val), 28, wlColors(wi,:), ...
                        'filled','MarkerFaceAlpha',0.85);
                    tpScatterFileTip(hsp, tpFileCol(pol_T));
                end
                xlim([0.72 2.28]); ylim([metricLo(mi) metricHi(mi)]);
                set(gca,'XColor','none','Box','off','TickDir','out','FontSize',8); grid off;
                if wi==1
                    ylabel(metricLbl{mi},'FontSize',10); set(gca,'YColor',[0.2 0.2 0.2]);
                else
                    set(gca,'YColor','none');
                end
                if isBottom
                    xl = xlabel(sprintf('%d',wls(wi)),'FontSize',10);
                    xl.Color=[0.15 0.15 0.15]; xl.Units='normalized'; xl.Position(2)=-0.025;
                end
            end
        end

        drawnow;   % finalise tile positions before drawing the shared baselines
        for mi = 1:nMet
            pL = axB(mi,1).Position;  pR = axB(mi,end).Position;
            annotation(f,'line',[pL(1) pR(1)+pR(3)],[pL(2) pL(2)], ...
                'Color',[0.2 0.2 0.2],'LineWidth',0.8);
        end
        xlabel(tl, 'Wavelength (nm)', 'FontSize',11, 'Color',[0.15 0.15 0.15]);

        % Save alongside the CSV
        [pp, bb] = fileparts(S.lastStatsCSV);
        try
            saveas(f, fullfile(pp,[bb '_figure.pdf']));
            saveas(f, fullfile(pp,[bb '_figure.png']));
            S.lblStatus.String = sprintf('Figure saved → %s_figure.png', bb);
        catch ME
            S.lblStatus.String = ['Figure error: ' ME.message];
        end
        setappdata(fig,'S',S);
    end

    function [cV, cM] = tpWlColor(wl)
    % Paired palette colours for the summary figure, anchored violet→red by
    % wavelength: cV = vivid swatch (used for pol), cM = muted swatch (dif).
    % Nearest anchor wins, so each stimulus line (365/460/520/660/740) is distinct.
    %   wl   vivid R G B            muted R G B
        P = [365  0.624 0.404 0.659  0.788 0.714 0.816;   % purple
             460  0.000 0.533 0.792  0.659 0.769 0.890;   % blue
             500  0.247 0.737 0.737  0.737 0.863 0.871;   % teal
             530  0.263 0.675 0.302  0.710 0.831 0.682;   % green
             580  0.573 0.757 0.239  0.816 0.878 0.643;   % lime
             610  0.976 0.714 0.090  0.961 0.863 0.639;   % yellow
             650  0.937 0.494 0.129  0.918 0.761 0.616;   % orange
             700  0.859 0.243 0.231  0.878 0.659 0.635];  % red
        [~,k] = min(abs(P(:,1)-wl));
        cV = P(k,2:4);  cM = P(k,5:7);
    end

    function tpPolarGuides(th_ring)
    % Light reference rings (R = 0.5, 1) and 45° spokes on the current axes.
        plot(0.5*cos(th_ring), 0.5*sin(th_ring), 'Color',[0.82 0.82 0.82],'LineWidth',0.5);
        plot(    cos(th_ring),     sin(th_ring),  'Color',[0.65 0.65 0.65],'LineWidth',0.8);
        for ang = 0:45:135
            plot([-cosd(ang) cosd(ang)],[-sind(ang) sind(ang)], ...
                'Color',[0.82 0.82 0.82],'LineWidth',0.5);
        end
    end

    function f = tpFileCol(tbl)
    % Filenames for the rows of a (sub)table, as a string column; empty
    % strings if the table has no 'file' column.
        if ismember('file', tbl.Properties.VariableNames)
            f = string(tbl.file);
        else
            f = strings(height(tbl), 1);
        end
    end

    function tpScatterFileTip(h, files)
    % Append a "File" row to a scatter object's hover data tip so mousing over
    % a point in the summary figure shows its source filename.
        try
            h.DataTipTemplate.DataTipRows(end+1) = dataTipTextRow('File', files);
            h.DataTipTemplate.Interpreter = 'none';   % show '_' literally, not as TeX subscript
        catch
        end
    end

end
