import React, { ReactElement } from 'react';
import SockJS from 'sockjs-client';
import { Client, IMessage } from '@stomp/stompjs';
import { useEffect, useState } from 'react';
import useStateRef from 'react-usestateref';
import { useNavigate } from 'react-router-dom';
import { axiosInstance, getJWTToken, hasJWTToken, parseJSON } from '../axiosConfig';
import { ChatList } from './ChatList/ChatList';
import { MessageArea } from './MessageArea/MessageArea';
import { ChatInfo } from './ChatInfo/ChatInfo';
import { MessageData } from '../model/MessageData';
import { ChatData } from '../model/ChatData';
import { ProfileInfo } from './ProfileInfo/ProfileInfo';
import { UserData } from '../model/UserData';
import { ChatDataWithLastMessage } from '../model/ChatDataWithLastMessage';
import { ChatDataWithMembersAndMessages } from '../model/ChatDataWithMembersAndMessages';


export function ChatPage() {
    const [users, setUsers, usersRef] = useStateRef(new Map<string, UserData>());
    const [userId, setUserId] = useState<string | null>(null);

    const [chatListLoaded, setChatListLoaded] = useState(false);
    const [chatList, setChatList, chatListRef] = useStateRef<ChatDataWithLastMessage[]>([]);
    const [loadedChats, setLoadedChats, loadedChatsRef] = useStateRef(new Map<string, ChatData>());
    const [activeChatId, setActiveChatId, activeChatIdRef] = useStateRef<string | null>(null);

    const [messageLists, setMessageLists, messageListsRef] = useStateRef(new Map<string, MessageData[]>());

    const [showChatInfo, setShowChatInfo] = useState(false);
    const [showProfileInfo, setShowProfileInfo] = useState(false);

    const [activeChatOpenedFirstTime, setActiveChatOpenedFirstTime] = useState(true);
    const [activeChatScrollPosition, setActiveChatScrollPosition] = useState(0);
    const [chatsScrollPositions, setChatsScrollPositions] = useState(new Map<string, number>());

    const [stompClient, setStompClient] = useState(new Client({
        webSocketFactory: () => new SockJS('http://localhost:8080/ws-connect'),
        connectHeaders: {
            'Authorization': 'Bearer ' + getJWTToken()
        }
    }));

    stompClient.onConnect = function () {
        setStompConnected(true);
    };
    
    const [stompConnected, setStompConnected] = useState(false);
    const [subscribedToStomp, setSubscribedToStomp] = useState(false);

    // subscribe when both user is initialized and stomp client is connected
    useEffect(() => {
        if (stompConnected && userId !== null && !subscribedToStomp) {
            setSubscribedToStomp(true);

            stompClient.subscribe('/messages/new', onMessageReceived);
            stompClient.subscribe(`/user/${userId}/profile-updates`, (message: IMessage) => {
                onUserProfileUpdated(JSON.parse(message.body));
            });
            stompClient.subscribe(`/user/${userId}/group-chat-profile-updates`, (message: IMessage) => {
                onChatProfileUpdated(JSON.parse(message.body));
            });
        }
    }, [stompConnected, userId]);

    useEffect(() => {
        stompClient.activate();
    }, []);

    function onMessageReceived(message: IMessage) {
        const newMessage = parseJSON(message.body);
        const previousMessages = messageListsRef.current.get(newMessage.groupChatId);
        if (previousMessages !== undefined) {
            const newMessages = previousMessages.concat([newMessage]);
            setMessageLists(messageLists => new Map(messageLists.set(newMessage.groupChatId, newMessages)));
        }
    }

    function onUserProfileUpdated(updatedUser: UserData) {
        if (usersRef.current.has(updatedUser.id)) {
            setUsers(users => new Map(users.set(updatedUser.id, updatedUser)));
        }
    }

    function onChatProfileUpdated(updatedChat: ChatData) {
        const updatedChatList = [...chatListRef.current];
        const updatedChatIndex = updatedChatList.findIndex(chat => chat.id === updatedChat.id);
        if (updatedChatIndex !== -1) {
            updatedChatList[updatedChatIndex] = {...updatedChatList[updatedChatIndex], ...updatedChat};
            setChatList(updatedChatList);
        }
        if (loadedChatsRef.current.has(updatedChat.id)) {
            setLoadedChats(loadedChats => new Map(loadedChats.set(updatedChat.id, updatedChat)));
        }
    }

    function onSendMessage(text: string) {
        if (activeChatId !== null) {
            axiosInstance.post('http://localhost:8080/send', {
                groupChatId: activeChatId,
                text: text
            });
        }
    }

    async function onChatSelected(chatId: string) {
        if (!messageLists.has(chatId)) {
            const chatInfoWithMessages = await getChatInfoAndMessages(chatId);
            setMessageLists(new Map(messageLists.set(chatId, chatInfoWithMessages.messages)));
            setLoadedChats(new Map(loadedChats.set(chatId, {
                id: chatInfoWithMessages.id,
                name: chatInfoWithMessages.name,
                profilePhotoLocation: chatInfoWithMessages.profilePhotoLocation,
                members: chatInfoWithMessages.members.map(user => user.id)
            })));
            for (const member of chatInfoWithMessages.members) {
                users.set(member.id, member);
            }
            setUsers(new Map(users));
        }
        setActiveChatId(chatId);
        if (activeChatId !== null) {
            setChatsScrollPositions(chatsScrollPositions.set(activeChatId, activeChatScrollPosition));
        }
        const savedChatScrollPosition = chatsScrollPositions.get(chatId);
        setActiveChatScrollPosition(savedChatScrollPosition !== undefined ? savedChatScrollPosition : 0);
        setActiveChatOpenedFirstTime(savedChatScrollPosition === undefined);
    }

    async function getChatInfoAndMessages(chatId: string): Promise<ChatDataWithMembersAndMessages> {
        const response = await axiosInstance.get(`http://localhost:8080/chat/${chatId}`);
        if (response.status !== 200) {
            throw new Error("Bad server response");
        }
    
        return response.data;
    }

    async function getUserInfo(): Promise<UserData | null> {
        try {
            const response = await axiosInstance.get('http://localhost:8080/profile-info');

            if (response.status !== 200) {
                throw new Error("Bad server response");
            }
    
            return response.data;
        } catch (e) {
            navigate('/login');
            return null;
        }
    }

    async function getChatList(): Promise<ChatDataWithLastMessage[]> {
        try {
            const response = await axiosInstance.get('http://localhost:8080/chats');

            if (response.status !== 200) {
                throw new Error("Bad server response");
            }
    
            return response.data;
        } catch (e) {
            navigate('/login');
            return [];
        }
    }

    const navigate = useNavigate();
    useEffect(() => {
        if (!hasJWTToken()) {
            navigate('/login');
            return;
        }
        (async () => {
            const user = await getUserInfo();
            if (user === null) {
                return;
            }
            setUsers(new Map(users.set(user.id, user)));
            setUserId(user.id);

            const chatList = await getChatList();
            setChatList(chatList);
            setChatListLoaded(true);
        })();
    }, []);

    if (userId === null || !chatListLoaded) {
        return null;
    }
    const user = users.get(userId);
    if (user === undefined) {
        return null;
    }

    let messageArea: ReactElement | false = false;
    let chatInfo: ReactElement | false = false;
    if (activeChatId !== null) {
        const activeChat = loadedChats.get(activeChatId);
        const activeMessageList = messageLists.get(activeChatId);
        if (activeChat !== undefined && activeMessageList !== undefined) {
            messageArea = <MessageArea
                    activeChatId={activeChatId}
                    activeChat={activeChat}
                    users={users}
                    messageList={activeMessageList}
                    openedFirstTime={activeChatOpenedFirstTime}
                    scrollPosition={activeChatScrollPosition}
                    onScroll={scrollPosition => {setActiveChatScrollPosition(scrollPosition);}}
                    onSendMessage={onSendMessage}
                    onShowChatInfo={() => setShowChatInfo(true)}
                />;
        }
        if (activeChat !== undefined) {
            chatInfo = <ChatInfo
                chat={activeChat}
                users={users}
                show={showChatInfo}
                onClose={() => setShowChatInfo(false)}
            />;
        }
    }
    
    return (
            <div className='chat-page'>
                <ChatList 
                    chatList={chatList}
                    activeChatId={activeChatId}
                    onChatSelected={onChatSelected}
                    onShowProfileInfo={() => setShowProfileInfo(true)}
                />
                {messageArea}
                {chatInfo}
                <ProfileInfo
                    user={user}
                    show={showProfileInfo}
                    onClose={() => setShowProfileInfo(false)}
                />
            </div>
        );

}